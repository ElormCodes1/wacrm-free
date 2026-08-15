import { describe, it, expect } from 'vitest';

import { parseAmountToMinor, formatMinor, minorUnitDigits } from './money';

describe('minorUnitDigits', () => {
  it('knows the common case', () => {
    expect(minorUnitDigits('GHS')).toBe(2);
    expect(minorUnitDigits('USD')).toBe(2);
  });

  it('knows currencies with no subdivision', () => {
    // ¥4800 is 4800 minor units, not 480000. Assuming 100 everywhere
    // would bill a Japanese customer a hundred times over.
    expect(minorUnitDigits('JPY')).toBe(0);
  });

  it('falls back rather than throwing on an unknown code', () => {
    expect(minorUnitDigits('XXX')).toBe(2);
  });
});

describe('parseAmountToMinor', () => {
  it('converts whole and decimal amounts', () => {
    expect(parseAmountToMinor('48', 'GHS')).toEqual({ ok: true, minor: 4800 });
    expect(parseAmountToMinor('48.50', 'GHS')).toEqual({ ok: true, minor: 4850 });
    expect(parseAmountToMinor('0.05', 'GHS')).toEqual({ ok: true, minor: 5 });
  });

  it('survives the float representation problem', () => {
    // 1.15 * 100 is 114.99999999999999 in IEEE 754. Truncating gives 114.
    expect(parseAmountToMinor('1.15', 'USD')).toEqual({ ok: true, minor: 115 });
    expect(parseAmountToMinor('19.99', 'USD')).toEqual({ ok: true, minor: 1999 });
    expect(parseAmountToMinor('0.29', 'USD')).toEqual({ ok: true, minor: 29 });
  });

  it('accepts pasted amounts with separators and a symbol', () => {
    expect(parseAmountToMinor('1,200.00', 'GHS')).toEqual({ ok: true, minor: 120000 });
    expect(parseAmountToMinor('$1,200', 'USD')).toEqual({ ok: true, minor: 120000 });
    expect(parseAmountToMinor(' 48.50 ', 'GHS')).toEqual({ ok: true, minor: 4850 });
  });

  it('uses the currency’s own precision', () => {
    expect(parseAmountToMinor('4800', 'JPY')).toEqual({ ok: true, minor: 4800 });
  });

  it('refuses more decimals than the currency has, rather than rounding', () => {
    // Rounding here would bill an amount nobody typed.
    const r = parseAmountToMinor('48.567', 'GHS');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/2 decimal places/);

    const jpy = parseAmountToMinor('48.5', 'JPY');
    expect(jpy.ok).toBe(false);
    expect(jpy.ok === false && jpy.error).toMatch(/no decimal places/);
  });

  it('refuses things that only look like numbers', () => {
    // parseFloat('48abc') is 48 — exactly the helpfulness that produces a
    // wrong invoice.
    for (const bad of ['48abc', 'abc', '4.8.5', '', '   ', '.']) {
      expect(parseAmountToMinor(bad, 'GHS').ok, `"${bad}" should be rejected`).toBe(false);
    }
  });

  it('refuses negatives', () => {
    expect(parseAmountToMinor('-10', 'GHS').ok).toBe(false);
  });

  it('refuses amounts beyond safe integer range', () => {
    expect(parseAmountToMinor('99999999999999999', 'GHS').ok).toBe(false);
  });
});

describe('formatMinor', () => {
  it('renders minor units back as money', () => {
    expect(formatMinor(4850, 'USD')).toContain('48.50');
    expect(formatMinor(120000, 'USD')).toContain('1,200.00');
  });

  it('renders a zero-decimal currency without inventing decimals', () => {
    expect(formatMinor(4800, 'JPY')).not.toContain('.');
  });

  it('shows a dash rather than 0 for nothing', () => {
    expect(formatMinor(null, 'GHS')).toBe('—');
    expect(formatMinor(undefined, 'GHS')).toBe('—');
  });

  it('round-trips every amount it parses', () => {
    for (const typed of ['0.01', '1.15', '19.99', '48.50', '1,200.00']) {
      const parsed = parseAmountToMinor(typed, 'USD');
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        const shown = formatMinor(parsed.minor, 'USD').replace(/[^0-9.,]/g, '');
        expect(shown).toBe(typed.includes(',') ? typed : Number(typed).toFixed(2));
      }
    }
  });
});
