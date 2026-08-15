/**
 * Money, stored as integer minor units.
 *
 * Everything in the billing tables is an integer: 4800 is GHS 48.00. That
 * removes the classic float problem where 0.1 + 0.2 is not 0.3 and a
 * ledger ends up a cent short, but it moves the risk to the boundary —
 * the moment a human types "48.50" and something has to turn it into
 * 4850. That conversion is what this module is for, and why it is tested
 * rather than inlined into a form handler.
 *
 * The number of minor units per major unit is NOT always 100. Yen has no
 * subdivision at all, so ¥4800 is 4800 minor units, not 480000. Rather
 * than keep a table of exponents that goes stale, we ask Intl — it
 * already knows, because it has to in order to format.
 */

/** Decimal places this currency actually uses. 2 for most, 0 for JPY. */
export function minorUnitDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    // An unknown code should not crash a page that is only displaying it.
    return 2;
  }
}

/** 4850, "GHS" -> "GH₵48.50" */
export function formatMinor(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return '—';
  const digits = minorUnitDigits(currency);
  const major = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(major);
  } catch {
    return `${major.toFixed(digits)} ${currency}`;
  }
}

/** Compact form for tight columns: 4850, "GHS" -> "48.50". */
export function formatMinorPlain(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return '—';
  const digits = minorUnitDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

export type ParseResult =
  | { ok: true; minor: number }
  | { ok: false; error: string };

/**
 * Turn what someone typed into minor units.
 *
 * Deliberately strict about the things that would silently mis-bill:
 *
 *   * More decimal places than the currency has. "48.567" in GHS is not a
 *     rounding question, it is a typo, and rounding it quietly bills an
 *     amount nobody chose.
 *
 *   * Anything that is not a number. parseFloat("48abc") returns 48,
 *     which is exactly the kind of helpfulness that produces a wrong
 *     invoice.
 *
 * Thousands separators and a leading currency symbol are accepted,
 * because people paste amounts.
 */
export function parseAmountToMinor(input: string, currency: string): ParseResult {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, error: 'Enter an amount' };

  // Strip grouping commas, spaces and any leading symbol — but nothing
  // else, so letters still fail rather than being ignored.
  const cleaned = raw.replace(/[\s,]/g, '').replace(/^[^\d.-]+/, '');

  if (!/^-?\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') {
    return { ok: false, error: 'That is not a number' };
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { ok: false, error: 'That is not a number' };
  if (value < 0) return { ok: false, error: 'Amount cannot be negative' };

  const digits = minorUnitDigits(currency);
  const dot = cleaned.indexOf('.');
  const typedDecimals = dot === -1 ? 0 : cleaned.length - dot - 1;
  if (typedDecimals > digits) {
    return {
      ok: false,
      error:
        digits === 0
          ? `${currency} has no decimal places`
          : `${currency} amounts have at most ${digits} decimal places`,
    };
  }

  // Round only the floating-point representation error (0.1*100 is
  // 10.000000000000002), never the operator's actual input — anything
  // that needed real rounding was rejected above.
  const minor = Math.round(value * 10 ** digits);
  if (!Number.isSafeInteger(minor)) return { ok: false, error: 'Amount is too large' };

  return { ok: true, minor };
}
