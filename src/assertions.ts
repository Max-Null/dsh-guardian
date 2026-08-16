/**
 * 触发线 1：断言检测与计数（纯函数，可单测）。
 *
 * 扫描 assistant 消息文本，匹配模型「凭空断言」的表述
 * （不支持/做不到/只有 N 种/不存在/无法 X/远低于/过于 X），
 * 计数并每 N 轮无断言衰减 1。等级按阈值分段。
 * @module @max-null/dsh-guardian/assertions
 */

import type { AssertionLevel, GuardianSessionState } from './types.ts'

/** 断言正则：来自 fractal guardian 的 ASSERTION_RE，`无法\s+\S+` 放宽为 `无法\s*\S+`（中文习惯无空格）。 */
export const ASSERTION_RE = /(?:不支持|做不到|只有\s*\d+\s*种|(?<!\S)(?:没有|缺少)\s+\S+|不存在|无法\s*\S+|远[比低高]\S+|过于\S+)/

/** 默认断言提醒阈值（升序）：count≤1 一级、2-3 二级、>3 三级。 */
export const DEFAULT_ASSERTION_THRESHOLDS = [1, 3]

/** 默认衰减轮数：连续 3 轮无断言 -1。 */
export const DEFAULT_DECAY_TURNS = 3

/** 断言规则的数值参数（由引擎从 config 解析后传入）。 */
export interface AssertionRules {
  /** 连续 N 轮无断言 → 计数 -1。 */
  decayTurns: number
  /** 升序阈值，决定等级分段。 */
  thresholds: readonly number[]
}

/** 默认规则。 */
export function defaultAssertionRules(): AssertionRules {
  return { decayTurns: DEFAULT_DECAY_TURNS, thresholds: DEFAULT_ASSERTION_THRESHOLDS }
}

/**
 * 扫描一段 assistant 文本是否含断言。
 * @param text - 助手消息文本。
 * @returns 是否命中断言正则。
 */
export function hasAssertion(text: string): boolean {
  return ASSERTION_RE.test(text)
}

/**
 * 由计数和阈值算等级。
 * @param count - 当前断言计数。
 * @param thresholds - 升序阈值数组。
 * @returns 等级（count=0 → 0）。
 */
export function assertionLevel(count: number, thresholds: readonly number[]): AssertionLevel | 0 {
  if (count <= 0) return 0
  for (let i = 0; i < thresholds.length; i += 1) {
    if (count <= thresholds[i]!) return (i + 1) as AssertionLevel
  }
  return (thresholds.length + 1) as AssertionLevel
}

/**
 * 一个 turn 的断言结算：本轮文本含断言 → 计数 +1、衰减水位清零；
 * 不含断言 → 衰减水位 +1，满 decayTurns 时计数 -1（不低于 0）。
 * @param state - 当前会话状态。
 * @param turnHasAssertion - 本轮 assistant 文本是否含断言。
 * @param rules - 断言规则（衰减轮数 + 阈值）。
 * @returns 更新后的状态。
 */
export function settleAssertionTurn(
  state: GuardianSessionState,
  turnHasAssertion: boolean,
  rules: AssertionRules = defaultAssertionRules(),
): GuardianSessionState {
  let { assertionCount, turnsSinceAssertion } = state
  if (turnHasAssertion) {
    assertionCount += 1
    turnsSinceAssertion = 0
  } else {
    turnsSinceAssertion += 1
    if (turnsSinceAssertion >= rules.decayTurns) {
      assertionCount = Math.max(0, assertionCount - 1)
      turnsSinceAssertion = 0
    }
  }
  return {
    ...state,
    assertionCount,
    turnsSinceAssertion,
    assertionLevel: assertionLevel(assertionCount, rules.thresholds),
  }
}

/**
 * 断言提醒文案（注入 systemPrompt；等级越高越严厉）。
 * @param state - 当前会话状态。
 * @returns 提醒文本；count=0 时为空串。
 */
export function assertionReminderText(state: GuardianSessionState): string {
  if (state.assertionCount <= 0) return ''
  if (state.assertionLevel === 1) {
    return '注意：本轮有未经验证的断言表述（如「不支持」「不存在」「做不到」）。回答前先联网查证或读代码确认，禁止凭记忆下结论。'
  }
  if (state.assertionLevel === 2) {
    return '⚠️ 本轮已多次出现未经验证的断言。所有「不能/没有/只有 N 种」类结论必须先查证再输出；不确定时直接说「需要验证」。'
  }
  return '⛔ 断言计数已严重超标：你正在大量输出未经验证的结论。立即停止猜测，每一个否定性结论都必须附带证据来源（文件路径/搜索结果/命令输出）。'
}
