import { NextResponse, type NextRequest } from 'next/server';
import { billingArrangementSchema } from '@propvault/validation';
import { z } from 'zod';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError, utilitiesDisabled } from '@/lib/smartUtility/http';

type RouteParams = { params: Promise<{ id: string }> };

/** GET — billing arrangements (who pays which utility, and how) per unit, with history. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const { data, error } = await auth.supabase
    .from('utility_billing_arrangements')
    .select('id, unit_id, utility_type, arrangement, invoice_mode, allocation_group_id, fixed_amount, allowance_quantity, effective_from, effective_to, contract_reference, notes, created_at, units(unit_label), utility_allocation_groups(name)')
    .eq('property_id', id)
    .order('effective_from', { ascending: false });
  if (error) return serverError('arrangements_failed', 'Could not load billing arrangements.', 'utility_arrangements.list', error);
  return NextResponse.json({ arrangements: data ?? [] });
}

/**
 * POST — set a unit's arrangement for a utility from a date. The previous open arrangement ends the day before,
 * so charges already calculated keep the arrangement that applied to them. Nothing is charged without one.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, billingArrangementSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!property.utilities_enabled) return utilitiesDisabled();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const d = parsed.data;
  if (d.arrangement === 'shared_allocation') {
    const { data: group } = await auth.supabase
      .from('utility_allocation_groups')
      .select('id, property_id, active, utility_meters(utility_type), utility_allocation_members(unit_id)')
      .eq('id', d.allocationGroupId!)
      .maybeSingle();
    if (!group || group.property_id !== property.id || !group.active) return jsonError(400, 'invalid_group', 'Shared meter group not found on this property.');
    const meter = group.utility_meters as unknown as { utility_type: string } | null;
    if (meter?.utility_type !== d.utilityType) return jsonError(400, 'invalid_group', 'That group measures a different utility.');
    if (!((group.utility_allocation_members ?? []) as { unit_id: string }[]).some((m) => m.unit_id === d.unitId)) {
      return jsonError(400, 'invalid_group', 'The unit is not a member of that shared meter group.');
    }
  }
  const { data: open } = await auth.supabase
    .from('utility_billing_arrangements')
    .select('id, effective_from')
    .eq('unit_id', d.unitId)
    .eq('property_id', property.id)
    .eq('utility_type', d.utilityType)
    .is('effective_to', null)
    .maybeSingle();
  if (open) {
    if (open.effective_from >= d.effectiveFrom) {
      return jsonError(409, 'arrangement_overlap', `The current arrangement starts on ${open.effective_from}; the new one must start after it.`);
    }
    const dayBefore = new Date(Date.parse(`${d.effectiveFrom}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const { error: closeError } = await auth.supabase.from('utility_billing_arrangements').update({ effective_to: dayBefore }).eq('id', open.id);
    if (closeError) return serverError('arrangement_close_failed', 'Could not end the previous arrangement.', 'utility_arrangements.close', closeError);
  }
  const { data, error } = await auth.supabase
    .from('utility_billing_arrangements')
    .insert({
      org_id: property.org_id,
      property_id: property.id,
      unit_id: d.unitId,
      utility_type: d.utilityType,
      arrangement: d.arrangement,
      invoice_mode: d.invoiceMode,
      allocation_group_id: d.arrangement === 'shared_allocation' ? d.allocationGroupId : null,
      fixed_amount: d.arrangement === 'fixed_allowance' ? d.fixedAmount : null,
      allowance_quantity: d.arrangement === 'fixed_allowance' ? (d.allowanceQuantity ?? null) : null,
      effective_from: d.effectiveFrom,
      contract_reference: d.contractReference || null,
      notes: d.notes || null,
      created_by: auth.user.id,
    })
    .select('id')
    .single();
  if (error) {
    if (/does not belong/.test(error.message)) return jsonError(400, 'invalid_scope', error.message);
    return serverError('arrangement_create_failed', 'Could not save the arrangement.', 'utility_arrangements.insert', error);
  }
  return NextResponse.json({ arrangementId: data.id }, { status: 201 });
}

const endSchema = z.object({ arrangementId: z.string().uuid(), effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** PATCH {arrangementId, effectiveTo} — end an arrangement (e.g. the unit moves to a prepaid meter in the tenant's name). */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, endSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!property.utilities_enabled) return utilitiesDisabled();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const { data, error } = await auth.supabase
    .from('utility_billing_arrangements')
    .update({ effective_to: parsed.data.effectiveTo })
    .eq('id', parsed.data.arrangementId)
    .eq('property_id', property.id)
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code === '23514') return jsonError(400, 'validation_failed', 'The end date must be on or after the start date.');
    return serverError('arrangement_end_failed', 'Could not end the arrangement.', 'utility_arrangements.end', error);
  }
  if (!data) return notFound('Arrangement');
  return NextResponse.json({ ok: true });
}
