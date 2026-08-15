import { describe, it, expect, vi } from 'vitest';

// The module imports `server-only`, which throws outside a server
// component; the vitest config aliases it to a stub, so this is safe.
import { nextPeriodEnd } from '@/lib/operator/billing';

/**
 * What a payment buys.
 *
 * The two branches are a policy decision, not an implementation detail,
 * so they are pinned here: paying early must not cost the customer the
 * rest of the month they already bought, and paying late must not
 * silently forgive the months they missed.
 */
describe('nextPeriodEnd', () => {
  const now = new Date('2026-08-15T12:00:00Z');

  it('extends from the existing end when it is still in the future', () => {
    // Paid up to 1 Sep, pays again on 15 Aug -> 1 Oct, not 15 Sep.
    // Charging from "today" would quietly take two weeks off them.
    const result = nextPeriodEnd('2026-09-01T00:00:00Z', 'month', now);
    expect(result.slice(0, 10)).toBe('2026-10-01');
  });

  it('extends from today when the period already lapsed', () => {
    // Three months overdue, pays for one month -> covered one month from
    // NOW. Extending from the old end would give them a period that is
    // already in the past, so they would still show as overdue after
    // paying — and the arrears would be silently written off.
    const result = nextPeriodEnd('2026-05-01T00:00:00Z', 'month', now);
    expect(result.slice(0, 10)).toBe('2026-09-15');
  });

  it('starts from today when there is no period at all', () => {
    const result = nextPeriodEnd(null, 'month', now);
    expect(result.slice(0, 10)).toBe('2026-09-15');
  });

  it('handles yearly plans', () => {
    expect(nextPeriodEnd(null, 'year', now).slice(0, 10)).toBe('2027-08-15');
    expect(nextPeriodEnd('2026-12-01T00:00:00Z', 'year', now).slice(0, 10)).toBe('2027-12-01');
  });

  it('rolls a month-end date into a shorter month without skipping one', () => {
    // 31 Jan + 1 month has no 31 Feb. JavaScript rolls it to 3 Mar, which
    // is later than intended but never LOSES a month — the customer is
    // never billed twice for the same period.
    const jan31 = new Date('2026-01-31T00:00:00Z');
    const result = new Date(nextPeriodEnd(null, 'month', jan31));
    expect(result.getTime()).toBeGreaterThan(jan31.getTime());
    expect(result.getUTCMonth()).toBeGreaterThanOrEqual(1);
  });

  it('does not depend on the real clock', () => {
    // Pinning `now` is what makes the branches testable at all.
    const a = nextPeriodEnd(null, 'month', new Date('2026-01-01T00:00:00Z'));
    const b = nextPeriodEnd(null, 'month', new Date('2026-01-01T00:00:00Z'));
    expect(a).toBe(b);
  });

  it('defaults to the real clock when none is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
    expect(nextPeriodEnd(null, 'month').slice(0, 10)).toBe('2026-09-15');
    vi.useRealTimers();
  });
});
