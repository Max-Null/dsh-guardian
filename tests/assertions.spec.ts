import { describe, expect, it } from 'vitest'
import {
  ASSERTION_RE,
  assertionLevel,
  assertionReminderText,
  hasAssertion,
  settleAssertionTurn,
} from '../src/assertions.ts'
import { emptySessionState } from '../src/types.ts'

describe('hasAssertion', () => {
  it('matches unsupported / cannot-do claims', () => {
    expect(hasAssertion('这个功能不支持')).toBe(true)
    expect(hasAssertion('做不到这一点')).toBe(true)
    expect(hasAssertion('只有 3 种方法')).toBe(true)
    expect(hasAssertion('该文件不存在')).toBe(true)
    expect(hasAssertion('无法读取这个目录')).toBe(true)
    expect(hasAssertion('过于复杂')).toBe(true)
    expect(hasAssertion('远低于预期')).toBe(true)
  })

  it('does not match factual statements', () => {
    expect(hasAssertion('我用 read 读了文件')).toBe(false)
    expect(hasAssertion('测试全部通过')).toBe(false)
  })
})

describe('assertionLevel', () => {
  it('0 count has no level', () => {
    expect(assertionLevel(0, [1, 3])).toBe(0)
  })

  it('segments by thresholds', () => {
    expect(assertionLevel(1, [1, 3])).toBe(1)
    expect(assertionLevel(2, [1, 3])).toBe(2)
    expect(assertionLevel(3, [1, 3])).toBe(2)
    expect(assertionLevel(4, [1, 3])).toBe(3)
  })
})

describe('settleAssertionTurn', () => {
  it('increments on assertion and resets decay watermark', () => {
    const state = settleAssertionTurn(emptySessionState(), true)
    expect(state.assertionCount).toBe(1)
    expect(state.turnsSinceAssertion).toBe(0)
    expect(state.assertionLevel).toBe(1)
  })

  it('decays after N clean turns', () => {
    let state = settleAssertionTurn(emptySessionState(), true) // 1
    state = settleAssertionTurn(state, false) // watermark 1
    state = settleAssertionTurn(state, false) // watermark 2
    state = settleAssertionTurn(state, false) // watermark 3 -> decay
    expect(state.assertionCount).toBe(0)
    expect(state.turnsSinceAssertion).toBe(0)
    expect(state.assertionLevel).toBe(0)
  })

  it('never decays below zero', () => {
    let state = emptySessionState()
    for (let i = 0; i < 6; i += 1) state = settleAssertionTurn(state, false)
    expect(state.assertionCount).toBe(0)
  })

  it('custom decay turns', () => {
    let state = settleAssertionTurn(emptySessionState(), true)
    state = settleAssertionTurn(state, false, { decayTurns: 1, thresholds: [1, 3] })
    expect(state.assertionCount).toBe(0)
  })
})

describe('assertionReminderText', () => {
  it('empty when count is zero', () => {
    expect(assertionReminderText(emptySessionState())).toBe('')
  })

  it('escalates by level', () => {
    const level1 = { ...emptySessionState(), assertionCount: 1, assertionLevel: 1 as const }
    const level3 = { ...emptySessionState(), assertionCount: 5, assertionLevel: 3 as const }
    expect(assertionReminderText(level1).length).toBeGreaterThan(0)
    expect(assertionReminderText(level3)).toContain('证据来源')
  })
})

describe('ASSERTION_RE', () => {
  it('is a global-ish regex usable repeatedly', () => {
    // 无 g 标志：lastIndex 不残留，可复用
    expect(ASSERTION_RE.flags).not.toContain('g')
    expect(ASSERTION_RE.test('不存在')).toBe(true)
    expect(ASSERTION_RE.test('不存在')).toBe(true)
  })
})
