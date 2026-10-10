import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { utilityTariffV2Schema, type UtilityTariffV2Input } from '@propvault/validation';
import { validateTariff, type TariffV2 } from './tariffEngine';

// Tariff administration (v2). Tariffs are entered per property (or per unit) from the municipality's / supplier's
// published schedule — there is no universal South African tariff and none is ever hardcoded.

export function inputToTariffV2(d: UtilityTariffV2Input): TariffV2 {
  return {
    name: d.name,
    kind: d.tariffKind,
    utilityType: d.utilityType,
    fixedCharge: d.fixedCharge,
    blocks: d.blocks,
    touPeriods: d.touPeriods,
    seasons: d.seasons,
    vatInclusive: d.vatInclusive,
    vatRate: d.vatRate,
    prorateBlocks: d.prorateBlocks,
  };
}

/** Kind-specific completeness on top of validateTariff (block order / TOU coverage / seasons). */
export function tariffProblem(d: UtilityTariffV2Input): string | null {
  if ((d.tariffKind === 'block' || d.tariffKind === 'cost_recovery') && d.blocks.length === 0 && !d.seasons.some((s) => s.blocks?.length)) {
    return 'Add at least one rate block (or seasonal blocks).';
  }
  if (d.tariffKind === 'flat' && d.blocks.length !== 1) return 'A flat tariff has exactly one rate (one block with no upper limit).';
  if (d.tariffKind === 'tou' && d.touPeriods.length === 0 && !d.seasons.some((s) => s.touPeriods?.length)) return 'Add the time-of-use periods.';
  return validateTariff(inputToTariffV2(d));
}

export function tariffInsertRow(d: UtilityTariffV2Input, orgId: string, propertyId: string, userId: string) {
  return {
    org_id: orgId,
    property_id: propertyId,
    unit_id: d.unitId ?? null,
    utility_type: d.utilityType,
    name: d.name,
    tariff_kind: d.tariffKind,
    fixed_charge: d.fixedCharge,
    blocks: d.blocks,
    tou_periods: d.touPeriods,
    seasons: d.seasons,
    vat_inclusive: d.vatInclusive,
    vat_rate: d.vatRate,
    prorate_blocks: d.prorateBlocks,
    supply_source_type: d.supplySourceType ?? null,
    customer_class: d.customerClass || null,
    municipality_code: d.municipalityCode ?? null,
    source_reference: d.sourceReference || null,
    effective_from: d.effectiveFrom,
    notes: d.notes || null,
    // Cost-recovery tariffs (landlord-defined rates) always need a contract/regulatory review before use.
    requires_review: d.tariffKind === 'cost_recovery',
    review_reason: d.tariffKind === 'cost_recovery' ? 'Landlord-defined cost-recovery rate: confirm lease clause and regulatory position.' : null,
    created_by: userId,
  };
}

/**
 * Inserts a tariff and closes the previous open-ended tariff of the same scope (utility + unit + source type)
 * the day before, so history is never overwritten. Used tariffs stay immutable (DB trigger); only effective_to
 * changes on them.
 */
export async function createTariff(client: SupabaseClient, d: UtilityTariffV2Input, orgId: string, propertyId: string, userId: string) {
  const dayBefore = new Date(Date.parse(`${d.effectiveFrom}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  let close = client
    .from('utility_tariffs')
    .update({ effective_to: dayBefore })
    .eq('property_id', propertyId)
    .eq('utility_type', d.utilityType)
    .is('effective_to', null)
    .lt('effective_from', d.effectiveFrom);
  close = d.unitId ? close.eq('unit_id', d.unitId) : close.is('unit_id', null);
  close = d.supplySourceType ? close.eq('supply_source_type', d.supplySourceType) : close.is('supply_source_type', null);
  const { error: closeError } = await close;
  if (closeError) throw closeError;
  const { data, error } = await client.from('utility_tariffs').insert(tariffInsertRow(d, orgId, propertyId, userId)).select('id').single();
  if (error) throw error;
  return data.id as string;
}

// ---- CSV import -------------------------------------------------------------------------------------------
// One row per tariff. Blocks are "upTo:rate" pairs separated by ';', the last with '*' for no upper limit,
// e.g. "6:25.10;15:32.50;*:45.00". TOU and seasonal tariffs are entered in the form (their structure does not
// fit one CSV row without ambiguity).

export const TARIFF_CSV_COLUMNS = [
  'utility_type',
  'name',
  'tariff_kind',
  'effective_from',
  'fixed_charge',
  'blocks',
  'vat_inclusive',
  'vat_rate',
  'unit_label',
  'municipality_code',
  'customer_class',
  'source_reference',
] as const;

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

function parseBlocks(s: string): { upTo: number | null; rate: number }[] | string {
  const out: { upTo: number | null; rate: number }[] = [];
  for (const part of s.split(';').map((p) => p.trim()).filter(Boolean)) {
    const [limit, rate] = part.split(':').map((x) => x.trim());
    const r = Number(rate);
    if (rate === undefined || rate === '' || !Number.isFinite(r)) return `Block "${part}" needs upTo:rate.`;
    if (limit === '*' || limit === '') out.push({ upTo: null, rate: r });
    else {
      const l = Number(limit);
      if (!Number.isFinite(l) || l <= 0) return `Block limit "${limit}" is not a positive number.`;
      out.push({ upTo: l, rate: r });
    }
  }
  return out;
}

export interface ImportRow {
  line: number;
  ok: boolean;
  errors: string[];
  tariff?: UtilityTariffV2Input;
}

export function parseTariffCsv(csv: string, unitIdsByLabel: Map<string, string>): { rows: ImportRow[]; headerError?: string } {
  const all = parseCsv(csv.replace(/^\uFEFF/, ''));
  if (all.length === 0) return { rows: [], headerError: 'The file is empty.' };
  const header = all[0]!.map((h) => h.trim().toLowerCase());
  const missing = ['utility_type', 'name', 'effective_from', 'blocks'].filter((c) => !header.includes(c));
  if (missing.length) return { rows: [], headerError: `Missing column(s): ${missing.join(', ')}. Expected: ${TARIFF_CSV_COLUMNS.join(', ')}.` };
  const col = (r: string[], name: string) => {
    const i = header.indexOf(name);
    return i < 0 ? '' : (r[i] ?? '').trim();
  };
  const rows: ImportRow[] = [];
  for (let i = 1; i < all.length; i++) {
    const r = all[i]!;
    const errors: string[] = [];
    const blocks = parseBlocks(col(r, 'blocks'));
    if (typeof blocks === 'string') errors.push(blocks);
    const unitLabel = col(r, 'unit_label');
    const unitId = unitLabel ? unitIdsByLabel.get(unitLabel.toLowerCase()) : null;
    if (unitLabel && !unitId) errors.push(`Unknown unit "${unitLabel}".`);
    const num = (v: string) => (v === '' ? undefined : Number(v.replace(',', '.')));
    const vatInc = col(r, 'vat_inclusive').toLowerCase();
    const candidate = {
      utilityType: col(r, 'utility_type').toLowerCase(),
      name: col(r, 'name'),
      tariffKind: col(r, 'tariff_kind').toLowerCase() || 'block',
      effectiveFrom: col(r, 'effective_from'),
      fixedCharge: num(col(r, 'fixed_charge')),
      blocks: typeof blocks === 'string' ? [] : blocks,
      vatInclusive: vatInc === '' ? undefined : ['true', 'yes', 'y', '1', 'incl'].includes(vatInc),
      vatRate: num(col(r, 'vat_rate')),
      unitId: unitId ?? null,
      municipalityCode: col(r, 'municipality_code') || null,
      customerClass: col(r, 'customer_class') || null,
      sourceReference: col(r, 'source_reference') || null,
    };
    if (['tou'].includes(candidate.tariffKind)) errors.push('Time-of-use tariffs are entered in the form, not by CSV.');
    const parsed = utilityTariffV2Schema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${issue.path.join('.') || 'row'}: ${issue.message}`);
    } else if (errors.length === 0) {
      const problem = tariffProblem(parsed.data);
      if (problem) errors.push(problem);
    }
    rows.push({ line: i + 1, ok: errors.length === 0, errors, tariff: parsed.success ? parsed.data : undefined });
  }
  return { rows };
}
