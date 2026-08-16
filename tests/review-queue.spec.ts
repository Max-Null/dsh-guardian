import { describe, expect, it } from 'vitest'
import { enqueueReview, reviewReminderText } from '../src/review-queue.ts'

describe('enqueueReview', () => {
  it('appends and stamps queuedAt', () => {
    const queue = enqueueReview([], { filePath: 'a.ts', sessionId: 's1', turn: 1 })
    expect(queue).toHaveLength(1)
    expect(queue[0]!.filePath).toBe('a.ts')
    expect(typeof queue[0]!.queuedAt).toBe('number')
  })

  it('dedupes same file + session, keeping the latest', () => {
    const first = enqueueReview([], { filePath: 'a.ts', sessionId: 's1', turn: 1 })
    const second = enqueueReview(first, { filePath: 'a.ts', sessionId: 's1', turn: 2 })
    expect(second).toHaveLength(1)
    expect(second[0]!.turn).toBe(2)
  })

  it('keeps different sessions separate', () => {
    const first = enqueueReview([], { filePath: 'a.ts', sessionId: 's1', turn: 1 })
    const second = enqueueReview(first, { filePath: 'a.ts', sessionId: 's2', turn: 1 })
    expect(second).toHaveLength(2)
  })

  it('FIFO evicts beyond max', () => {
    let queue = enqueueReview([], { filePath: 'a.ts', sessionId: 's1', turn: 1 }, 2)
    queue = enqueueReview(queue, { filePath: 'b.ts', sessionId: 's1', turn: 1 }, 2)
    queue = enqueueReview(queue, { filePath: 'c.ts', sessionId: 's1', turn: 1 }, 2)
    expect(queue).toHaveLength(2)
    expect(queue[0]!.filePath).toBe('b.ts')
    expect(queue[1]!.filePath).toBe('c.ts')
  })
})

describe('reviewReminderText', () => {
  it('empty when the session has no pending reviews', () => {
    expect(reviewReminderText([], 's1')).toBe('')
  })

  it('lists the session files', () => {
    const queue = enqueueReview(
      enqueueReview([], { filePath: 'a.ts', sessionId: 's1', turn: 1 }),
      { filePath: 'b.ts', sessionId: 's1', turn: 2 },
    )
    const text = reviewReminderText(queue, 's1')
    expect(text).toContain('a.ts')
    expect(text).toContain('b.ts')
    expect(text).toContain('2 个文件')
  })

  it('caps listed entries', () => {
    let queue = enqueueReview([], { filePath: 'a.ts', sessionId: 's1', turn: 1 }, 10)
    for (let i = 0; i < 5; i += 1) {
      queue = enqueueReview(queue, { filePath: `f${i}.ts`, sessionId: 's1', turn: 2 }, 10)
    }
    const text = reviewReminderText(queue, 's1', 3)
    expect(text).toContain('另有')
  })
})
