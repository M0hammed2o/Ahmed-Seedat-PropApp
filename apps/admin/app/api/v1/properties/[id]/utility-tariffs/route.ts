import { NextResponse, type NextRequest } from 'next/server';
import { utilityTariffV2Schema } from '@propvault/validation';
import { z } from 'zod';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError, utilitiesDisabled } from '@/lib/smartUtility/http';
import { createTariff, tariffProblem } from '@/lib/smartUtility/tariffAdmin';

type RouteParams = { params: Promise<{ id: string }> };

const TARIFF_LIST_COLUMNS =
  'id, utility_type, name, tariff_kind, fixed_charge, blocks, tou_periods, seasons, vat_inclusive, vat_rate, prorate_blocks, unit_id, supply_source_type, customer_class, municipality_code, source_reference, requires_review, review_reason, reviewed_at, effective_from, effective_to, notes, created_at, units(unit_label)';

/** GET — the property's tariffs (history kept; newest first). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const { data, error } = await auth.supabase
    .from('utility_tariffs')
    .select(TARIFF_LIST_COLUMNS)
    .eq('property_id', id)
    .order('effective_from', { ascending: false });
  if (error) return serverError('tariffs_failed', 'Could not load tariffs.', 'utility_tariffs.list', error);
  return NextResponse.json({ tariffs: data ?? [] });
}

/**
 * POST — a new tariff version (block / TOU / seasonal / flat / fixed-only / cost-recovery / prepaid pass-through),
 * property-wide or for one unit, effective from a date. The previous open-ended tariff of the same scope is closed
 * the day before; tariffs already used by a charge are immutable (DB trigger), so history is never rewritten.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, utilityTariffV2Schema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!property.utilities_enabled) return utilitiesDisabled();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const problem = tariffProblem(parsed.data);
  if (problem) return jsonError(400, 'invalid_tariff', problem);
  try {
    const tariffId = await createTariff(auth.supabase, parsed.data, property.org_id, property.id, auth.user.id);
    return NextResponse.json({ tariffId }, { status: 201 });
  } catch (error) {
    return serverError('tariff_create_failed', 'Could not save the tariff.', 'utility_tariffs.insert', error);
  }
}

const patchSchema = z.object({
  tariffId: z.string().uuid(),
  action: z.enum(['mark_reviewed', 'end']),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** PATCH — mark a tariff reviewed, or end it on a date. Rates themselves are never edited: add a new version. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, patchSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!property.utilities_enabled) return utilitiesDisabled();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  if (parsed.data.action === 'end' && !parsed.data.effectiveTo) return jsonError(400, 'validation_failed', 'Provide effectiveTo.');
  const patch =
    parsed.data.action === 'mark_reviewed'
      ? { requires_review: false, reviewed_by: auth.user.id, reviewed_at: new Date().toISOString() }
      : { effective_to: parsed.data.effectiveTo };
  const { data, error } = await auth.supabase
    .from('utility_tariffs')
    .update(patch)
    .eq('id', parsed.data.tariffId)
    .eq('property_id', property.id)
    .select('id')
    .maybeSingle();
  if (error) return serverError('tariff_update_failed', 'Could not update the tariff.', 'utility_tariffs.update', error);
  if (!data) return notFound('Tariff');
  return NextResponse.json({ ok: true });
}
