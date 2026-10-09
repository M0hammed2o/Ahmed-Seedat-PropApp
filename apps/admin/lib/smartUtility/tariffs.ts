// Utility tariffs (migration 176 utility_tariffs). Pure. Rates are per display unit (kL / kWh) per
// billing period; blocks are ascending with an open-ended last block (upTo = null). Every figure
// produced here is an ESTIMATE until a landlord approves the charge.

export interface TariffBlock {
  upTo: number | null;
  rate: number;
}

export interface TariffInput {
  fixedCharge: number;
  blocks: TariffBlock[];
}

export interface ChargeBreakdownLine {
  from: number;
  to: number | null;
  units: number;
  rate: number;
  amount: number;
}

export interface ChargeResult {
  fixedAmount: number;
  usageAmount: number;
  total: number;
  breakdown: ChargeBreakdownLine[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Returns an error message, or null when the blocks are valid. */
export function validateBlocks(blocks: TariffBlock[]): string | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return 'At least one rate block is required.';
  if (blocks.length > 10) return 'At most 10 rate blocks.';
  let prev = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (!Number.isFinite(b.rate) || b.rate < 0) return `Block ${i + 1}: rate must be zero or more.`;
    const last = i === blocks.length - 1;
    if (last) {
      if (b.upTo !== null) return 'The last block must be open-ended (no upper limit).';
    } else {
      if (b.upTo === null || !Number.isFinite(b.upTo) || b.upTo <= prev) {
        return `Block ${i + 1}: upper limit must be greater than ${prev}.`;
      }
      prev = b.upTo;
    }
  }
  return null;
}

export function computeCharge(consumption: number, tariff: TariffInput): ChargeResult {
  const err = validateBlocks(tariff.blocks);
  if (err) throw new Error(err);
  if (!Number.isFinite(consumption) || consumption < 0) throw new Error('Consumption must be zero or more.');
  let remaining = consumption;
  let from = 0;
  const breakdown: ChargeBreakdownLine[] = [];
  for (const b of tariff.blocks) {
    if (remaining <= 0) break;
    const cap = b.upTo === null ? Infinity : b.upTo - from;
    const units = Math.min(remaining, cap);
    breakdown.push({ from, to: b.upTo, units: Math.round(units * 10_000) / 10_000, rate: b.rate, amount: r2(units * b.rate) });
    remaining -= units;
    from = b.upTo ?? from + units;
  }
  const usageAmount = r2(breakdown.reduce((s, l) => s + l.amount, 0));
  const fixedAmount = r2(tariff.fixedCharge);
  return { fixedAmount, usageAmount, total: r2(usageAmount + fixedAmount), breakdown };
}
