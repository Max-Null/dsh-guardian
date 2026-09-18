/**
 * 引擎失败兜底：落盘失败与事件处理失败都不得逃逸到进程。
 *
 * 复刻的现场见 `docs/排查/2026-09-17-DSH内核崩溃退出-排查记录.md`：
 * `writeChain` 一旦 rejected 就保持 rejected（后续写入全部立即失败），
 * 而 `void this.handleEvent(...)` 丢弃的 promise 无人接管 —— Node 默认把
 * 未处理的 rejection 当致命错误，于是一次存储写失败终止了整个内核进程。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { GuardianEngine } from '../src/engine.ts'
import { emptySessionState, type GuardianSessionState } from '../src/types.ts'

/** 引擎私有面：直接驱动，避免为一个用例搭完整的 storage 环境。 */
interface EngineInternals {
  unit: KvUnit | undefined
  handleEvent: (session: Session, event: SessionEvent) => Promise<void>
  bindSessionEvents: () => void
  flushSession: (sessionId: string, state: GuardianSessionState) => Promise<void>
  flushQueue: () => Promise<void>
}

/** 捕获 stderr 诊断行——`absorbFailure` 的落地通道（宿主落进 kernel-child.log）。 */
function captureStderr(): string[] {
  const lines: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation(((
    chunk: unknown,
  ) => {
    lines.push(String(chunk))
    return true
  }) as unknown as typeof process.stderr.write)
  return lines
}

afterEach(() => {
  vi.restoreAllMocks()
})

/** 建一个引擎 + 捕获诊断行（断言「记录并吞掉」里的「记录」）。 */
function makeEngine() {
  const ctx = new Context()
  const lines = captureStderr()
  const engine = new GuardianEngine(ctx, { globalRoot: 'unused-by-this-spec' })
  return { ctx, internals: engine as unknown as EngineInternals, lines }
}

/** 撞锁单元：两个写入口都抛 EPERM（复刻 rename 被进程外文件锁打断）。 */
function lockedUnit(): KvUnit {
  const boom = async (): Promise<never> => {
    throw new Error('EPERM: operation not permitted, rename')
  }
  return { putRecord: boom, setGlobal: boom } as unknown as KvUnit
}

/** 可用单元：只记录调用，不落盘。 */
function recordingUnit(calls: string[]): KvUnit {
  return {
    putRecord: async (table: string, sessionId: string) => {
      calls.push(`${table}/${sessionId}`)
    },
    setGlobal: async () => {
      calls.push('global')
    },
  } as unknown as KvUnit
}

describe('落盘失败兜底', () => {
  it('flushSession 吞掉写失败，且 writeChain 保持可用', async () => {
    const { internals, lines } = makeEngine()
    internals.unit = lockedUnit()

    await expect(internals.flushSession('s1', emptySessionState())).resolves.toBeUndefined()
    expect(lines.join('\n')).toContain('会话状态落盘失败')

    // 链未被毒化：换成可用单元后，下一次写入仍然真的执行。
    const calls: string[] = []
    internals.unit = recordingUnit(calls)
    await internals.flushSession('s1', emptySessionState())
    expect(calls).toEqual(['sessions/s1'])
  })

  it('flushQueue 吞掉写失败，且 writeChain 保持可用', async () => {
    const { internals, lines } = makeEngine()
    internals.unit = lockedUnit()

    await expect(internals.flushQueue()).resolves.toBeUndefined()
    expect(lines.join('\n')).toContain('审查队列落盘失败')

    const calls: string[] = []
    internals.unit = recordingUnit(calls)
    await internals.flushQueue()
    expect(calls).toEqual(['global'])
  })

  it('连续失败逐次累计，日志不省略', async () => {
    const { internals, lines } = makeEngine()
    internals.unit = lockedUnit()

    await internals.flushSession('s1', emptySessionState())
    await internals.flushQueue()
    await internals.flushSession('s1', emptySessionState())

    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('累计 3 次')
  })
})

describe('事件入口兜底', () => {
  it('handleEvent 抛错时不 reject，且经监听器进入也不产生未处理 rejection', async () => {
    const { ctx, internals, lines } = makeEngine()
    internals.bindSessionEvents()
    internals.handleEvent = async () => {
      throw new Error('boom from handleEvent')
    }

    const session = { id: 's1' } as unknown as Session
    const event = { type: 'turn/end', data: {} } as unknown as SessionEvent
    ctx.emit('session/event', session, event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(lines.join('\n')).toContain('事件处理失败')
    expect(lines.join('\n')).toContain('boom from handleEvent')
  })
})
