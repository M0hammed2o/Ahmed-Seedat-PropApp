// Decimal-safe money for utility billing (docs/HYBRID_UTILITIES_ARCHITECTURE.md §D). No floating-point
// currency: quantities and rates are scaled BigInt (6 dp), currency is integer cents, every line is
// rounded half-up exactly once, and VAT is computed per line from the rounded line amount.

export const SCALE = 1_000_000n; // 6 dp for quantities and rates

/** Parses a decimal number or numeric string into 6-dp scaled BigInt, rounding half-up beyond 6 dp. */
export function toScaled(value: number | string | null | undefined): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  let s = typeof value === 'number' ? numberToPlain(value) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Not a decimal: ${value}`);
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  const [intPart, fracRaw = ''] = s.split('.');
  const frac = (fracRaw + '0000000').slice(0, 7); // one extra digit for rounding
  let scaled = BigInt(intPart!) * SCALE + BigInt(frac.slice(0, 6));
  if (Number(frac[6]) >= 5) scaled += 1n;
  return negative ? -scaled : scaled;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new Error('Not a finite number');
  // Up to 10 significant decimals is enough for metered values (L, kWh) and tariff rates.
  return n.toFixed(10).replace(/\.?0+$/, '') || '0';
}

/** Divides with half-up rounding (away from zero for negatives). */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('Division by zero');
  const neg = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (2n * d);
  return neg ? -q : q;
}

/** quantity (scaled) × rate (scaled, Rand per unit) → cents, rounded half-up. */
export function lineCents(quantityScaled: bigint, rateScaled: bigint): bigint {
  // q·r has scale 1e12 Rand; cents = q·r·100 / 1e12
  return divRound(quantityScaled * rateScaled * 100n, SCALE * SCALE);
}

/** Rand (scaled) → cents. */
export function randToCents(randScaled: bigint): bigint {
  return divRound(randScaled * 100n, SCALE);
}

export interface VatSplit {
  excl: bigint;
  vat: bigint;
  incl: bigint;
}

/** Splits a line amount (cents) entered either VAT-inclusive or exclusive, VAT rate in percent. */
export function vatSplit(amountCents: bigint, vatInclusive: boolean, vatRatePct: number | string): VatSplit {
  const rate = toScaled(vatRatePct); // percent, 6 dp
  const hundred = 100n * SCALE;
  if (vatInclusive) {
    const excl = divRound(amountCents * hundred, hundred + rate);
    return { excl, vat: amountCents - excl, incl: amountCents };
  }
  const vat = divRound(amountCents * rate, hundred);
  return { excl: amountCents, vat, incl: amountCents + vat };
}

export function centsToNumber(c: bigint): number {
  return Number(c) / 100;
}

export function scaledToNumber(s: bigint): number {
  return Number(s) / 1_000_000;
}

/** Splits `totalCents` by integer weights so the parts sum exactly (largest remainder, ties by order). */
export function allocateCents(totalCents: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  const raw = weights.map((w) => totalCents * w);
  const base = raw.map((r) => r / sum);
  let remainder = totalCents - base.reduce((a, b) => a + b, 0n);
  const order = raw
    .map((r, i) => ({ i, rem: r % sum }))
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  const out = [...base];
  for (const { i } of order) {
    if (remainder <= 0n) break;
    out[i]! += 1n;
    remainder -= 1n;
  }
  return out;
}
