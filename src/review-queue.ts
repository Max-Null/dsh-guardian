/**
 * 触发线 3：编辑审查队列（纯函数，可单测）。
 *
 * 每次成功的文件编辑入队（filePath + sessionId + turn），FIFO 上限 N（默认 20）。
 * 会话结束时队列里属于该会话的条目保留给 UI 展示；提醒注入由引擎负责。
 * @module @max-null/dsh-guardian/review-queue
 */

import type { ReviewItem } from './types.ts'

/** 默认队列上限。 */
export const DEFAULT_REVIEW_QUEUE_MAX = 20

/** 编辑类工具名（与 no-feedback 的 EDIT_TOOL_NAMES 一致）。 */
export const REVIEW_TOOL_NAMES = new Set(['write', 'edit'])

/**
 * 一条编辑入队：去重同会话同文件的旧条目（保留最新），FIFO 淘汰超限。
 * @param queue - 当前队列（旧在前，新在后）。
 * @param item - 入队条目（不含 queuedAt，由本函数填）。
 * @param max - 队列上限。
 * @returns 更新后的队列。
 */
export function enqueueReview(
  queue: readonly ReviewItem[],
  item: Omit<ReviewItem, 'queuedAt'>,
  max: number = DEFAULT_REVIEW_QUEUE_MAX,
): ReviewItem[] {
  const next: ReviewItem[] = queue.filter(
    existing => !(existing.filePath === item.filePath && existing.sessionId === item.sessionId),
  )
  next.push({ ...item, queuedAt: Date.now() })
  while (next.length > max) next.shift()
  return next
}

/**
 * 会话结束后的审查提醒文案（列最多 N 条待审查文件）。
 * @param queue - 当前队列。
 * @param sessionId - 结束的会话。
 * @param maxListed - 最多列出的条目数。
 * @returns 提醒文本；该会话无待审查时为空串。
 */
export function reviewReminderText(
  queue: readonly ReviewItem[],
  sessionId: string,
  maxListed: number = 4,
): string {
  const items = queue.filter(item => item.sessionId === sessionId)
  if (items.length === 0) return ''
  const shown = items.slice(-maxListed)
  const more = items.length > maxListed ? `\n…另有 ${items.length - maxListed} 个文件未列出。` : ''
  const lines = shown.map(item => `- ${item.filePath}`)
  return `📝 本轮编辑了 ${items.length} 个文件，尚未审查：\n${lines.join('\n')}${more}\n`
    + '请按你的审查习惯（diff 复核 / 运行测试 / 自查一遍）处理后再继续。'
}
