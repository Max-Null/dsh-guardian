/**
 * `dsh-guardian`: Guardian 状态引擎插件（三个触发线监控 + 提醒注入）。
 *
 * 加载于 cordis.yml 的 storage / system-prompt 行旁；注册 `ctx.guardian`
 * 服务（断言计数 / 无反馈环 / 编辑审查队列），并在 system prompt 注入
 * 动态提醒（断言提醒、无反馈环警告、审查提醒——每轮组装时按当前状态求值）。
 * @module @max-null/dsh-guardian
 */

import type { Context } from '@deepseek-ai/cordis'
import { GuardianEngine } from './engine.ts'
import type { GuardianConfig } from './types.ts'
// Side-effect type import: resolves `ctx.systemPrompt` to the service.
import type {} from '@deepseek-ai/dsh-system-prompt'

export { GuardianEngine } from './engine.ts'
export {
  ASSERTION_RE,
  assertionLevel,
  assertionReminderText,
  defaultAssertionRules,
  hasAssertion,
  settleAssertionTurn,
  type AssertionRules,
} from './assertions.ts'
export {
  DEFAULT_NO_FEEDBACK_THRESHOLD,
  EDIT_TOOL_NAMES,
  EXEC_TOOL_NAMES,
  noFeedbackWarningText,
  noteToolCall,
  settleFeedbackTurn,
} from './no-feedback.ts'
export {
  DEFAULT_REVIEW_QUEUE_MAX,
  enqueueReview,
  reviewReminderText,
} from './review-queue.ts'
export type {
  AssertionLevel,
  GuardianConfig,
  GuardianSessionState,
  GuardianSnapshot,
  ReviewItem,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    guardian: GuardianEngine
  }
}

export const name = 'dsh-guardian'
export const inject = ['storage', 'systemPrompt']

export async function apply(ctx: Context, config?: GuardianConfig): Promise<void> {
  await ctx.plugin(GuardianEngine, config)
  // 读全局服务 store（引擎自己提供的服务，不是本插件的 inject）。
  const guardian = ctx.get('guardian')
  if (guardian === undefined) throw new Error('guardian engine failed to register')
  // 三个动态提醒：每轮组装时按当前会话状态求值，空文本不贡献。
  ctx.systemPrompt.context({
    name: 'guardian:assertion',
    order: 60,
    text: () => guardian.assertionReminder(),
  })
  ctx.systemPrompt.context({
    name: 'guardian:no-feedback',
    order: 61,
    text: () => guardian.noFeedbackWarning(),
  })
  ctx.systemPrompt.context({
    name: 'guardian:review',
    order: 62,
    text: () => guardian.reviewReminder(),
  })
}
