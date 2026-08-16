import { describe, expect, it } from 'vitest'
import {
  noFeedbackWarningText,
  noteToolCall,
  settleFeedbackTurn,
} from '../src/no-feedback.ts'
import { emptySessionState } from '../src/types.ts'

describe('noteToolCall', () => {
  it('counts edit tools', () => {
    const state = noteToolCall(emptySessionState(), 'write')
    expect(state.editsThisTurn).toBe(1)
    expect(noteToolCall(state, 'edit').editsThisTurn).toBe(2)
  })

  it('flags exec tools', () => {
    expect(noteToolCall(emptySessionState(), 'bash').bashThisTurn).toBe(true)
    expect(noteToolCall(emptySessionState(), 'pwsh').bashThisTurn).toBe(true)
  })

  it('ignores other tools', () => {
    const state = noteToolCall(emptySessionState(), 'web_search')
    expect(state.editsThisTurn).toBe(0)
    expect(state.bashThisTurn).toBe(false)
  })
})

describe('settleFeedbackTurn', () => {
  it('increments on edit-without-exec', () => {
    let state = noteToolCall(emptySessionState(), 'write')
    state = settleFeedbackTurn(state)
    expect(state.noFeedbackTurns).toBe(1)
    expect(state.editsThisTurn).toBe(0)
    expect(state.bashThisTurn).toBe(false)
  })

  it('resets on exec', () => {
    let state = noteToolCall(emptySessionState(), 'write')
    state = noteToolCall(state, 'bash')
    state = settleFeedbackTurn(state)
    expect(state.noFeedbackTurns).toBe(0)
  })

  it('holds when neither edited nor executed', () => {
    let state = settleFeedbackTurn(emptySessionState()) // 0
    state = noteToolCall(state, 'write')
    state = settleFeedbackTurn(state) // 1
    state = settleFeedbackTurn(emptySessionState()) // 0 -> hold
    expect(state.noFeedbackTurns).toBe(0)
  })
})

describe('noFeedbackWarningText', () => {
  it('empty below threshold', () => {
    expect(noFeedbackWarningText(emptySessionState())).toBe('')
    expect(noFeedbackWarningText({ ...emptySessionState(), noFeedbackTurns: 2 })).toBe('')
  })

  it('warns at threshold with turn count', () => {
    const state = { ...emptySessionState(), noFeedbackTurns: 3 }
    expect(noFeedbackWarningText(state)).toContain('连续 3 轮')
    expect(noFeedbackWarningText(state)).toContain('反馈环')
  })

  it('honors custom threshold', () => {
    const state = { ...emptySessionState(), noFeedbackTurns: 3 }
    expect(noFeedbackWarningText(state, 5)).toBe('')
  })
})
