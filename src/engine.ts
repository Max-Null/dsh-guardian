/**
 * Guardian 状态引擎：监听 session/event，驱动三个触发线
 * （断言计数 / 无反馈环 / 编辑审查队列），状态存两层 storage。
 *
 * 状态以内存为权威（Map + 数组），turn 结算时 flush 到 JSON 存储。
 * 多会话并发安全：状态按 sessionId 分桶；提醒注入取「最近活跃会话」
 * （DSH web 典型场景单会话活跃，跨会话串扰后果轻微且可接受）。
 * @module @max-null/dsh-guardian/engine
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import {
  assertionReminderText,
  defaultAssertionRules,
  hasAssertion,
  settleAssertionTurn,
  type AssertionRules,
} from './assertions.ts'
import {
  noteToolCall,
  noFeedbackWarningText,
  settleFeedbackTurn,
  EDIT_TOOL_NAMES,
} from './no-feedback.ts'
import {
  enqueueReview,
  reviewReminderText,
} from './review-queue.ts'
import {
  emptySessionState,
  type GuardianConfig,
  type GuardianSessionState,
  type GuardianSnapshot,
  type ReviewItem,
} from './types.ts'

/** 状态存储 unit 名。 */
const UNIT_NAME = 'guardian'
/** 会话状态表名。 */
const SESSIONS_TABLE = 'sessions'

/** 默认 global 存储根：$DSH_HOME/storages/guardian。 */
function defaultGlobalRoot(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'guardian')
}

/** 从 assistant 消息提取全部文本块。 */
function assistantText(event: SessionEvent<'assistant/message'>): string {
  return event.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/**
 * 从编辑工具的 raw arguments JSON 解析目标文件路径。
 * write/edit 的参数名都是 file_path（str_replace_editor 的 edit 同）。
 * @returns 路径；解析失败或缺失时 undefined（该次编辑不入审查队列）。
 */
function parseEditFilePath(toolName: string, rawArguments: string): string | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as { file_path?: unknown }
    return typeof parsed.file_path === 'string' && parsed.file_path.length > 0
      ? parsed.file_path
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Guardian 引擎服务（服务名 `guardian`）。
 * 暴露 snapshot() 给 UI（SSiD 侧栏同进程直读）。
 */
export class GuardianEngine extends Service {
  static inject = ['storage']

  private readonly rules: AssertionRules
  private readonly reviewMax: number
  private readonly noFeedbackThreshold: number

  private unit: KvUnit | undefined
  private readonly sessions = new Map<string, GuardianSessionState>()
  private reviewQueue: ReviewItem[] = []
  /** callId → 待确认的编辑（filePath + 归属），tool/result 成功时入队。 */
  private readonly pendingEdits = new Map<string, { filePath: string; sessionId: string; turn: number }>()
  /** 最近收到事件的会话 id（提醒注入的近似目标）。 */
  private activeSessionId = ''
  /** 串行化磁盘写（KvUnit 不序列化并发写）。 */
  private writeChain: Promise<void> = Promise.resolve()
  /** 被吞掉的失败累计次数（诊断用：连续增长说明存储或环境有问题）。 */
  private failureCount = 0

  constructor(ctx: Context, private readonly config: GuardianConfig = {}) {
    super(ctx, 'guardian')
    const decayTurns = config.decayTurns
    const thresholds = config.assertionThresholds
    this.rules = {
      decayTurns: decayTurns === undefined ? defaultAssertionRules().decayTurns : decayTurns,
      thresholds: thresholds === undefined ? defaultAssertionRules().thresholds : thresholds,
    }
    this.reviewMax = config.reviewQueueMax ?? 20
    this.noFeedbackThreshold = config.noFeedbackThreshold ?? 3
  }

  /** 当前会话状态（无则空态，不落盘）。 */
  sessionState(sessionId: string): GuardianSessionState {
    return this.sessions.get(sessionId) ?? emptySessionState()
  }

  /** UI 快照：最近活跃会话的状态 + 审查队列。 */
  snapshot(): GuardianSnapshot {
    const session = this.sessionState(this.activeSessionId)
    return { session, reviewQueue: [...this.reviewQueue].reverse() }
  }

  /** 断言提醒（供 systemPrompt.context 动态求值）。 */
  assertionReminder(): string {
    return assertionReminderText(this.sessionState(this.activeSessionId))
  }

  /** 无反馈环警告（供 systemPrompt.context 动态求值）。 */
  noFeedbackWarning(): string {
    return noFeedbackWarningText(this.sessionState(this.activeSessionId), this.noFeedbackThreshold)
  }

  /** 审查提醒（供 systemPrompt.context 动态求值）。 */
  reviewReminder(): string {
    return reviewReminderText(this.reviewQueue, this.activeSessionId)
  }

  protected async [Service.init](): Promise<void> {
    const root = this.config.globalRoot ?? defaultGlobalRoot()
    const backend = new JsonStorageBackend(root)
    this.ctx.storage.backend.register('guardian-global', backend)
    this.ctx.effect(() => async () => { await backend.close() }, 'guardian.backendClose')

    this.unit = await backend.kv.open({
      name: UNIT_NAME,
      version: 1,
      tables: [SESSIONS_TABLE],
      hasGlobal: true,
    })
    const snapshot = await this.unit.loadAll()
    for (const [sessionId, value] of Object.entries(snapshot.tables[SESSIONS_TABLE] ?? {})) {
      this.sessions.set(sessionId, value as GuardianSessionState)
    }
    this.reviewQueue = Array.isArray(snapshot.global) ? snapshot.global as ReviewItem[] : []

    this.bindSessionEvents()
  }

  /**
   * 注册 `session/event` 监听。
   *
   * 监听器是同步回调，不能 await 事件处理，因此包装层必须自己吞掉失败
   * （见 `handleEventSafely`）——`void` 掉一个会 reject 的 promise 等于
   * 把未处理的 rejection 交给进程。
   */
  private bindSessionEvents(): void {
    this.ctx.on('session/event', (session: Session, event: SessionEvent) => {
      void this.handleEventSafely(session, event)
    })
  }

  /**
   * 事件入口的安全包装：任何失败都不得逃逸为未处理的 rejection。
   *
   * Node 默认把未处理的 rejection 当作致命错误，所以一次存储写失败就足以
   * 终止承载全部会话的内核进程。guardian 的状态（断言计数、审查队列）都是
   * **可重建的提示性状态**，正确的后果是「丢一次本次更新」，而不是进程退出。
   */
  private async handleEventSafely(session: Session, event: SessionEvent): Promise<void> {
    try {
      await this.handleEvent(session, event)
    } catch (error) {
      this.absorbFailure('事件处理失败', error)
    }
  }

  /**
   * 记录并吞掉一次不应逃逸到进程的失败。
   *
   * 走 stderr 而不是 `ctx.logger`：`ctx.logger.warn` 的默认阈值是 1（只放行
   * error/info），warn 的消息连 cordis 的内存 buffer 都进不去，更不会到任何
   * 文件——等于静默吞掉。宿主侧 stderr 才是落地的：SSiD 壳把内核子进程的
   * stderr 落进 `~/.ssid/kernel-child.log`。同类先例见 `dsh-ssid-pwsh-retry`。
   * @param scope — 失败环节，用于日志定位
   * @param error — 原始错误（只取 message，状态本身可重建）
   */
  private absorbFailure(scope: string, error: unknown): void {
    this.failureCount += 1
    const detail = error instanceof Error ? error.message : String(error)
    try {
      process.stderr.write(
        `[guardian] ${scope}（累计 ${this.failureCount} 次，本次更新已丢弃）：${detail}\n`,
      )
    } catch {
      // Electron 无控制台宿主下 stderr 不可写，忽略——诊断不该影响状态机
    }
  }

  /** 事件分发：按类型推进三个触发线，turn/end 时结算 + flush。 */
  private async handleEvent(session: Session, event: SessionEvent): Promise<void> {
    const sessionId = String(session.id)
    this.activeSessionId = sessionId
    const base = this.sessionState(sessionId)

    switch (event.type) {
      case 'assistant/message': {
        const text = assistantText(event)
        if (hasAssertion(text)) {
          this.sessions.set(sessionId, { ...base, assertedThisTurn: true })
        }
        break
      }
      case 'tool/call': {
        this.sessions.set(sessionId, noteToolCall(base, event.data.name))
        if (EDIT_TOOL_NAMES.has(event.data.name)) {
          const filePath = parseEditFilePath(event.data.name, event.data.arguments)
          if (filePath !== undefined) {
            this.pendingEdits.set(String(event.data.callId), {
              filePath,
              sessionId,
              turn: event.data.turn,
            })
          }
        }
        break
      }
      case 'tool/result': {
        if (event.data.error !== undefined) break
        // callId 在 tool/call 里；tool/result 通过 message.content[0].toolCallId 配对。
        const toolCallId = event.data.message.content[0]?.toolCallId
        if (toolCallId === undefined) break
        const pending = this.pendingEdits.get(String(toolCallId))
        if (pending !== undefined) {
          this.pendingEdits.delete(String(toolCallId))
          this.reviewQueue = enqueueReview(
            this.reviewQueue,
            { filePath: pending.filePath, sessionId: pending.sessionId, turn: pending.turn },
            this.reviewMax,
          )
          void this.flushQueue()
        }
        break
      }
      case 'turn/end': {
        const afterAssertion = settleAssertionTurn(base, base.assertedThisTurn, this.rules)
        const settled = settleFeedbackTurn({ ...afterAssertion, assertedThisTurn: false })
        this.sessions.set(sessionId, settled)
        this.activeSessionId = sessionId
        await this.flushSession(sessionId, settled)
        break
      }
      default:
        break
    }
  }

  /**
   * 序列化写一条会话状态。
   *
   * `catch` 不可省略：`writeChain` 一旦 rejected 就**保持** rejected，链上
   * 后续写入会立即失败，`turn/end` 的 `await` 还会把它冒泡到事件入口。
   * 吞掉失败后链始终可用，下一次写入照常尝试。
   */
  private flushSession(sessionId: string, state: GuardianSessionState): Promise<void> {
    this.writeChain = this.writeChain
      .then(async () => {
        await this.unit?.putRecord(SESSIONS_TABLE, sessionId, state)
      })
      .catch((error: unknown) => {
        this.absorbFailure('会话状态落盘失败', error)
      })
    return this.writeChain
  }

  /** 序列化写审查队列（global slot）。吞掉失败的理由同 `flushSession`。 */
  private flushQueue(): Promise<void> {
    this.writeChain = this.writeChain
      .then(async () => {
        await this.unit?.setGlobal(this.reviewQueue)
      })
      .catch((error: unknown) => {
        this.absorbFailure('审查队列落盘失败', error)
      })
    return this.writeChain
  }
}

export default GuardianEngine
