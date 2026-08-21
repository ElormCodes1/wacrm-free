import { describe, it, expect } from 'vitest'

import {
  DEFAULT_HISTORY_HOURS,
  historyHoursFromEnv,
  withinHistoryWindow,
} from './history-window'

const LINKED = Date.UTC(2026, 7, 21, 12, 0, 0)
const hoursFromLink = (h: number) => Math.floor((LINKED + h * 60 * 60 * 1000) / 1000)

describe('historyHoursFromEnv', () => {
  it('defaults to no run-up at all', () => {
    expect(DEFAULT_HISTORY_HOURS).toBe(0)
    expect(historyHoursFromEnv(undefined)).toBe(0)
    expect(historyHoursFromEnv('')).toBe(0)
    expect(historyHoursFromEnv('nonsense')).toBe(0)
    expect(historyHoursFromEnv('-5')).toBe(0)
  })

  it('accepts an explicit run-up for anyone who wants one', () => {
    expect(historyHoursFromEnv('24')).toBe(24)
    expect(historyHoursFromEnv('0.5')).toBe(0.5)
  })
})

describe('withinHistoryWindow', () => {
  it('drops everything from before the link', () => {
    expect(withinHistoryWindow(hoursFromLink(-1), LINKED, 0)).toBe(false)
    expect(withinHistoryWindow(hoursFromLink(-24 * 90), LINKED, 0)).toBe(false)
  })

  it('keeps everything from the link onwards', () => {
    expect(withinHistoryWindow(hoursFromLink(0), LINKED, 0)).toBe(true)
    expect(withinHistoryWindow(hoursFromLink(1), LINKED, 0)).toBe(true)
  })

  /**
   * The case a blanket "no history" rule gets wrong. A message sent an
   * hour after linking, delivered late because the socket was down, is
   * not old history — it is conversation this account missed, and it
   * arrives under the same event.
   */
  it('keeps a reconnect backlog message however late it arrives', () => {
    const sentAfterLink = hoursFromLink(6)
    // Days later, on reconnect. Still kept: it is after the link.
    expect(withinHistoryWindow(sentAfterLink, LINKED, 0)).toBe(true)
  })

  it('honours a configured run-up before the link', () => {
    expect(withinHistoryWindow(hoursFromLink(-2), LINKED, 24)).toBe(true)
    expect(withinHistoryWindow(hoursFromLink(-25), LINKED, 24)).toBe(false)
  })

  /**
   * Both unknowns err towards storing. An untidy inbox is recoverable;
   * a silently discarded message is not.
   */
  it('keeps a message with no usable timestamp', () => {
    for (const bad of [undefined, null, '', 'nope', 0, -1, NaN]) {
      expect(withinHistoryWindow(bad, LINKED, 0)).toBe(true)
    }
  })

  it('keeps everything when the link time is unknown', () => {
    expect(withinHistoryWindow(hoursFromLink(-24 * 30), null, 0)).toBe(true)
  })

  it('accepts a numeric string, which is how it arrives on the wire', () => {
    expect(withinHistoryWindow(String(hoursFromLink(1)), LINKED, 0)).toBe(true)
    expect(withinHistoryWindow(String(hoursFromLink(-1)), LINKED, 0)).toBe(false)
  })
})
