/**
 * 触发线 2：无反馈环（纯函数，可单测）。
 *
 * 每轮统计：编辑工具（write/edit）调用数 + 执行工具（bash/pwsh）是否调用。
 * turn 结算：有编辑且无执行 → 连续轮数 +1；有执行 → 清零。
 * 连续 N 轮（默认 3）「改代码但没跑测试」触发警告。
 * @module @max-null/dsh-guardian/no-feedback
 */

import type { GuardianSessionState } from './types.ts'

/** 默认警告阈值：连续 3 轮编辑但无执行。 */
export const DEFAULT_NO_FEEDBACK_THRESHOLD = 3

/** 编辑类工具名（写入/修改文件）。 */
export const EDIT_TOOL_NAMES = new Set(['write', 'edit'])

/** 执行/测试类工具名（跑命令 = 有反馈环）。 */
export const EXEC_TOOL_NAMES = new Set(['bash', 'pwsh'])

/**
 * 记录一轮内的工具调用：编辑工具累加 editsThisTurn，执行工具置 bashThisTurn。
 * @param state - 当前会话状态。
 * @param toolName - 本轮调用的工具名。
 * @returns 更新后的状态。
 */
export function noteToolCall(state: GuardianSessionState, toolName: string): GuardianSessionState {
  if (EDIT_TOOL_NAMES.has(toolName)) {
    return { ...state, editsThisTurn: state.editsThisTurn + 1 }
  }
  if (EXEC_TOOL_NAMES.has(toolName)) {
    return { ...state, bashThisTurn: true }
  }
  return state
}

/**
 * turn 结算：有编辑且无执行 → noFeedbackTurns +1；有执行 → 清零。
 * 本轮统计复位（editsThisTurn/bashThisTurn 归零）。
 * @param state - 当前会话状态。
 * @returns 更新后的状态。
 */
export function settleFeedbackTurn(state: GuardianSessionState): GuardianSessionState {
  const edited = state.editsThisTurn > 0
  const executed = state.bashThisTurn
  const noFeedbackTurns = edited && !executed
    ? state.noFeedbackTurns + 1
    : executed ? 0 : state.noFeedbackTurns
  return {
    ...state,
    noFeedbackTurns,
    editsThisTurn: 0,
    bashThisTurn: false,
  }
}

/**
 * 无反馈环警告文案；未达阈值时为空串。
 * @param state - 当前会话状态。
 * @param threshold - 警告阈值。
 * @returns 警告文本。
 */
export function noFeedbackWarningText(
  state: GuardianSessionState,
  threshold: number = DEFAULT_NO_FEEDBACK_THRESHOLD,
): string {
  if (state.noFeedbackTurns < threshold) return ''
  return `⚠️ 反馈环缺失：连续 ${state.noFeedbackTurns} 轮修改代码但没有运行测试。`
    + '在下一次修改代码前，先运行相关测试建立「能变红」的反馈环，再继续修复。'
}
