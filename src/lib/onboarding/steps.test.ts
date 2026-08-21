import { describe, it, expect } from 'vitest'

import {
  GUIDE_STEPS,
  setupProgress,
  setupTasks,
  type SetupState,
} from './steps'

const state = (over: Partial<SetupState> = {}): SetupState => ({
  numberLinked: false,
  hasConversation: false,
  hasBusinessContact: false,
  ...over,
})

describe('GUIDE_STEPS', () => {
  it('has unique ids', () => {
    const ids = GUIDE_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * The guide exists mainly to make the one blocking dependency visible.
   * If linking a number drifts down the order — or loses its route — a new
   * workspace is back to a dashboard of zeroes with no idea why.
   */
  it('puts linking a number near the front, with somewhere to go', () => {
    const index = GUIDE_STEPS.findIndex((s) => s.id === 'link-number')
    expect(index).toBeGreaterThanOrEqual(0)
    expect(index).toBeLessThanOrEqual(1)
    expect(GUIDE_STEPS[index].route).toBe('settings')
  })

  /**
   * The failure that prompted all of this: a WhatsApp QR is a pairing
   * token, so a phone camera returns gibberish and people conclude the
   * code is broken. If this warning is ever dropped, the confusion comes
   * straight back.
   */
  it('warns that the QR must be scanned from inside WhatsApp', () => {
    const step = GUIDE_STEPS.find((s) => s.id === 'link-number')
    expect(step?.warning).toBeTruthy()
    expect(step?.warning?.toLowerCase()).toContain('linked devices')
    expect(step?.warning?.toLowerCase()).toContain('camera')
  })

  it('keeps every step short enough to be read', () => {
    for (const step of GUIDE_STEPS) {
      expect(step.title.length).toBeLessThanOrEqual(60)
      expect(step.body.length).toBeLessThanOrEqual(220)
    }
  })

  it('gives every step with a route a button label', () => {
    for (const step of GUIDE_STEPS) {
      if (step.route) expect(step.action).toBeTruthy()
    }
  })
})

describe('setupTasks', () => {
  it('leads with linking a number, because nothing works without it', () => {
    expect(setupTasks(state())[0].id).toBe('number')
  })

  it('reflects real state rather than what was clicked through', () => {
    const tasks = setupTasks(state({ numberLinked: true }))
    expect(tasks.find((t) => t.id === 'number')?.done).toBe(true)
    expect(tasks.find((t) => t.id === 'conversation')?.done).toBe(false)
  })

  /**
   * Before a number is linked, "message someone first" is advice the
   * person cannot act on — so the hint has to say the blocking thing
   * instead.
   */
  it('adapts the conversation hint to whether a number exists yet', () => {
    const before = setupTasks(state()).find((t) => t.id === 'conversation')
    const after = setupTasks(state({ numberLinked: true })).find(
      (t) => t.id === 'conversation',
    )
    expect(before?.hint).not.toBe(after?.hint)
    expect(before?.hint).toMatch(/link a number/i)
  })
})

describe('setupProgress', () => {
  it('counts nothing, some and all', () => {
    expect(setupProgress(state())).toEqual({ done: 0, total: 3 })
    expect(setupProgress(state({ numberLinked: true }))).toEqual({
      done: 1,
      total: 3,
    })
    expect(
      setupProgress(
        state({
          numberLinked: true,
          hasConversation: true,
          hasBusinessContact: true,
        }),
      ),
    ).toEqual({ done: 3, total: 3 })
  })
})
