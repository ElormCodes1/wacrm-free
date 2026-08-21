import { describe, it, expect } from 'vitest'

import {
  DEFAULT_HISTORY_HOURS,
  historyHoursFromEnv,
  withinHistoryWindow,
} from './history-window'

const NOW = Date.UTC(2026, 7, 21, 12, 0, 0)
const hoursAgo = (h: number) => Math.floor((NOW - h * 60 * 60 * 1000) / 1000)

describe('historyHoursFromEnv', () => {
  it('defaults when unset or unparseable', () => {
    expect(historyHoursFromEnv(undefined)).toBe(DEFAULT_HISTORY_HOURS)
    expect(historyHoursFromEnv('')).toBe(DEFAULT_HISTORY_HOURS)
    expect(historyHoursFromEnv('   ')).toBe(DEFAULT_HISTORY_HOURS)
    expect(historyHoursFromEnv('soon')).toBe(DEFAULT_HISTORY_HOURS)
    expect(historyHoursFromEnv('-3')).toBe(DEFAULT_HISTORY_HOURS)
  })

  /**
   * The setting most likely to be typo'd into meaninglessness. "Ingest no
   * history at all" is a real choice, and treating 0 as "unset" would
   * quietly give the person the exact behaviour they asked to turn off.
   */
  it('keeps 0, which means "no history at all"', () => {
    expect(historyHoursFromEnv('0')).toBe(0)
  })

  it('accepts a custom window, including a fractional one', () => {
    expect(historyHoursFromEnv('72')).toBe(72)
    expect(historyHoursFromEnv('0.5')).toBe(0.5)
  })
})

describe('withinHistoryWindow', () => {
  it('keeps messages inside the window and drops older ones', () => {
    expect(withinHistoryWindow(hoursAgo(1), 24, NOW)).toBe(true)
    expect(withinHistoryWindow(hoursAgo(23), 24, NOW)).toBe(true)
    expect(withinHistoryWindow(hoursAgo(25), 24, NOW)).toBe(false)
    expect(withinHistoryWindow(hoursAgo(24 * 90), 24, NOW)).toBe(false)
  })

  it('drops everything when the window is 0', () => {
    expect(withinHistoryWindow(hoursAgo(0), 0, NOW)).toBe(false)
    expect(withinHistoryWindow(hoursAgo(1000), 0, NOW)).toBe(false)
  })

  /**
   * Keeping an untimestamped message is the deliberate choice: this cap
   * saves disk, and losing a real message to a malformed field would cost
   * far more than storing one extra.
   */
  it('keeps a message whose timestamp is missing or unusable', () => {
    for (const bad of [undefined, null, '', 'nonsense', 0, -1, NaN]) {
      expect(withinHistoryWindow(bad, 24, NOW)).toBe(true)
    }
  })

  it('accepts a numeric string, which is how it arrives on the wire', () => {
    expect(withinHistoryWindow(String(hoursAgo(2)), 24, NOW)).toBe(true)
    expect(withinHistoryWindow(String(hoursAgo(48)), 24, NOW)).toBe(false)
  })

  it('does not drop a message dated slightly in the future', () => {
    // Phone clocks drift. A message stamped a minute ahead is not old.
    expect(withinHistoryWindow(hoursAgo(-1), 24, NOW)).toBe(true)
  })
})
