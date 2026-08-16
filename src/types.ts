/**
 * dsh-guardian 共享类型：三个触发线的状态与提醒结构。
 * @module @max-null/dsh-guardian/types
 */

/** 断言等级：count ≤ threshold[0] 为 1 级，依此类推，超出为 thresholds.length+1。 */
export type AssertionLevel = 1 | 2 | 3

/** 一个会话的 Guardian 状态（断言计数 + 无反馈环 + 轮次水位）。 */
export interface GuardianSessionState {
  /** 断言计数（含衰减后的当前值）。 */
  assertionCount: number
  /** 距上次检测到断言的轮数（用于每 3 轮衰减 1）。 */
  turnsSinceAssertion: number
  /** 当前断言等级（count=0 时无等级，UI 显示 0）。 */
  assertionLevel: AssertionLevel | 0
  /** 本轮是否已检测到断言（turn 内累积，结算时清零）。 */
  assertedThisTurn: boolean
  /** 连续「改代码但没跑测试」的轮数。 */
  noFeedbackTurns: number
  /** 本轮是否已有编辑（turn 内统计）。 */
  editsThisTurn: number
  /** 本轮是否调用过 bash/pwsh（turn 内统计）。 */
  bashThisTurn: boolean
}

/** 一条待审查的编辑记录。 */
export interface ReviewItem {
  /** 被编辑的文件路径。 */
  filePath: string
  /** 触发审查的会话 id。 */
  sessionId: string
  /** 发生编辑的轮次号。 */
  turn: number
  /** 入队时间（epoch ms）。 */
  queuedAt: number
}

/** Guardian 引擎对外暴露的快照（侧栏 UI 读这个）。 */
export interface GuardianSnapshot {
  /** 当前会话的触发线状态。 */
  session: GuardianSessionState
  /** 待审查编辑队列（FIFO，最新在前）。 */
  reviewQueue: ReviewItem[]
}

/** 引擎配置。 */
export interface GuardianConfig {
  /** 断言计数衰减：连续 N 轮无断言 -1。 */
  decayTurns?: number
  /** 断言提醒阈值（升序），决定等级分段。 */
  assertionThresholds?: number[]
  /** 无反馈环警告阈值：连续 N 轮编辑但无 bash 触发。 */
  noFeedbackThreshold?: number
  /** 审查队列上限（FIFO 淘汰）。 */
  reviewQueueMax?: number
  /** global 状态存储根；默认 `$DSH_HOME/storages/guardian`。 */
  globalRoot?: string
}

/** 空会话状态。 */
export function emptySessionState(): GuardianSessionState {
  return {
    assertionCount: 0,
    turnsSinceAssertion: 0,
    assertionLevel: 0,
    assertedThisTurn: false,
    noFeedbackTurns: 0,
    editsThisTurn: 0,
    bashThisTurn: false,
  }
}
