import { NextResponse, type NextRequest } from 'next/server';
import { utilityTariffCreateSchema } from '@propvault/validation';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';
import { validateBlocks } from '@/lib/smartUtility/tariffs';

type RouteParams = { params: Promise<{ id: string }> };

/** GET — the property's tariffs (history kept; newest first). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const { data, error } = await auth.supabase
    .from('utility_tariffs')
    .select('id, utility_type, name, fixed_charge, blocks, vat_inclusive, effective_from, effective_to, notes, created_at')
    .eq('property_id', id)
    .order('effective_from', { ascending: false });
  if (error) return serverError('tariffs_failed', 'Could not load tariffs.', 'utility_tariffs.list', error);
  return NextResponse.json({ tariffs: data ?? [] });
}

/**
 * POST — a new tariff (fixed charge per period + ascending rate blocks per kL/kWh), effective
 * from a date. The previous open-ended tariff for the same utility is closed the day before, so
 * history is never overwritten.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, utilityTariffCreateSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const blockError = validateBlocks(parsed.data.blocks);
  if (blockError) return jsonError(400, 'invalid_blocks', blockError);
  const d = parsed.data;
  const dayBefore = new Date(Date.parse(`${d.effectiveFrom}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  await auth.supabase
    .from('utility_tariffs')
    .update({ effective_to: dayBefore })
    .eq('property_id', property.id)
    .eq('utility_type', d.utilityType)
    .is('effective_to', null)
    .lt('effective_from', d.effectiveFrom);
  const { data, error } = await auth.supabase
    .from('utility_tariffs')
    .insert({
      org_id: property.org_id,
      property_id: property.id,
      utility_type: d.utilityType,
      name: d.name,
      fixed_charge: d.fixedCharge,
      blocks: d.blocks,
      vat_inclusive: d.vatInclusive,
      effective_from: d.effectiveFrom,
      notes: d.notes || null,
      created_by: auth.user.id,
    })
    .select('id')
    .single();
  if (error) return serverError('tariff_create_failed', 'Could not save the tariff.', 'utility_tariffs.insert', error);
  return NextResponse.json({ tariffId: data.id }, { status: 201 });
}
