/**
 * Money is carried as an integer number of **sen** everywhere — in the database,
 * over the API, and through every aggregation. No amount is ever a float, so
 * rounding cannot accumulate across a month of claim items.
 */

export type Sen = number;

export function senFromRinggit(ringgit: number): Sen {
  if (!Number.isFinite(ringgit)) throw new Error(`not an amount: ${ringgit}`);
  // Round half away from zero on the sen boundary; the input is a decimal
  // RM figure from a form or an import, never a computed rate.
  const scaled = ringgit * 100;
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

export function senFromDecimalString(text: string): Sen {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) throw new Error(`not a decimal RM amount: ${text}`);
  const sign = m[1] ? -1 : 1;
  const sen = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return sign * sen;
}

/** `1234` → `"12.34"`. Used for display and for CSV export. */
export function ringgitString(sen: Sen): string {
  const neg = sen < 0;
  const abs = Math.abs(Math.trunc(sen));
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** `1234` → `"RM 12.34"`. */
export function formatRinggit(sen: Sen): string {
  return `RM ${ringgitString(sen)}`;
}

export function sumSen(values: readonly Sen[]): Sen {
  return values.reduce((a, b) => a + b, 0);
}
