import { NextResponse, type NextRequest } from 'next/server';
import {
  chargeAdjustmentSchema,
  chargeDisputeSchema,
  utilityChargesActionSchema,
  utilityChargesGenerateSchema,
  utilityCreditSchema,
} from '@propvault/validation';
import { z } from 'zod';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, requireUser, serverError, utilitiesDisabled } from '@/lib/smartUtility/http';
import {
  adjustCharge,
  approveCharges,
  BillingError,
  creditCharge,
  disputeCharge,
  generateCharges,
  invoiceCharges,
  voidCharges,
} from '@/lib/smartUtility/billing';

const adjustBody = chargeAdjustmentSchema.extend({ action: z.literal('adjust') });
const disputeBody = chargeDisputeSchema.extend({ op: z.literal('dispute') });
const creditBody = utilityCreditSchema.extend({ action: z.literal('credit') });

type RouteParams = { params: Promise<{ id: string }> };

/** GET — charge history (all statuses), newest period first. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const { data, error } = await auth.supabase
    .from('utility_charges')
    .select('id, unit_id, meter_id, lease_id, tenant_id, utility_type, charge_type, period_start, period_end, segment_start, segment_end, proration_factor, allocation_share, opening_reading, closing_reading, consumption, consumption_quality, fixed_amount, usage_amount, total_amount, amount_excl_vat, vat_amount, adjustment_total, credit_applied, review_flags, dispute_status, dispute_reason, dispute_resolution, status, approved_at, invoice_id, notes, tariff_snapshot, calculation, created_at, units(unit_label)')
    .eq('property_id', id)
    .order('period_start', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(300);
  if (error) return serverError('charges_failed', 'Could not load utility charges.', 'utility_charges.list', error);
  return NextResponse.json({ charges: data ?? [] });
}

/**
 * POST {periodStart, periodEnd} — compute DRAFT charges from each unit's billing arrangement (idempotent).
 * POST {action, chargeIds} — approve / void / add approved charges to DRAFT invoices.
 * POST {action:'adjust'|'credit', chargeId, amount, reason}; POST {op:'dispute', action:'open'|'resolve', chargeId, text}.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!property.utilities_enabled) return utilitiesDisabled();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const service = getServiceRoleClient();
  try {
    const adjust = adjustBody.safeParse(body);
    if (adjust.success) {
      return NextResponse.json(await adjustCharge(service, { ...adjust.data, propertyId: property.id, actorUserId: auth.user.id }));
    }
    const dispute = disputeBody.safeParse(body);
    if (dispute.success) {
      return NextResponse.json(await disputeCharge(service, { ...dispute.data, propertyId: property.id, actorUserId: auth.user.id }));
    }
    const credit = creditBody.safeParse(body);
    if (credit.success) {
      return NextResponse.json(await creditCharge(service, { ...credit.data, propertyId: property.id, actorUserId: auth.user.id }), { status: 201 });
    }
    const action = utilityChargesActionSchema.safeParse(body);
    if (action.success) {
      const a = { chargeIds: action.data.chargeIds, propertyId: property.id, actorUserId: auth.user.id };
      if (action.data.action === 'approve') return NextResponse.json(await approveCharges(service, a));
      if (action.data.action === 'void') return NextResponse.json(await voidCharges(service, a));
      return NextResponse.json(await invoiceCharges(auth.supabase, service, { ...a, dueInDays: action.data.dueInDays }));
    }
    const gen = utilityChargesGenerateSchema.safeParse(body);
    if (!gen.success) return jsonError(400, 'validation_failed', 'Provide periodStart and periodEnd, or an action with chargeIds.');
    const result = await generateCharges(service, { propertyId: property.id, ...gen.data, actorUserId: auth.user.id });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof BillingError) return jsonError(409, 'billing_rejected', error.message);
    return serverError('charges_action_failed', 'Could not complete that action.', 'utility_charges.action', error);
  }
}
