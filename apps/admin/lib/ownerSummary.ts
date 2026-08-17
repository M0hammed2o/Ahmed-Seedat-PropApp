import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// WhatsApp V1 final pre-production pass, Phase 4 (WORKLOG.md this date): the owner_monthly_
// property_summary aggregation, for real. Deliberately reads ONLY the existing accounting
// primitives (rent_schedules, whose `status = 'paid'` is the one and only thing this codebase
// already treats as a confirmed, ledger-level payment) plus payment_reports for the *awaiting*
// bucket -- never the other way around. A payment_reports row with `status = 'reported'` is
// counted in `awaitingConfirmation` and NEVER folded into `confirmedPaid`; once an accountant+
// calls confirm_payment_report() (migration 20260101000106), that RPC still does not touch
// rent_schedules/cash_receipts (documented there, re-affirmed here) -- so a "confirmed" payment
// report and a "paid" rent_schedule remain two independent facts an owner can see side by side,
// not a single blended number that could double-count the same real-world payment.

export interface OwnerMonthlySummaryData {
  ownerId: string;
  ownerUserId: string;
  orgId: string;
  periodStart: string;
  periodEnd: string;
  propertyCount: number;
  expectedRent: number;
  confirmedPaid: number;
  outstanding: number;
  awaitingConfirmation: number;
  openMaintenanceCount: number;
  upcomingLeaseExpiryCount: number;
}

export interface OwnerMonthlySummaryRow extends OwnerMonthlySummaryData {
  id: string;
  generatedAt: string;
  sentAt: string | null;
  whatsappMessageId: string | null;
}

function mapRow(row: {
  id: string;
  org_id: string;
  owner_id: string;
  owner_user_id: string;
  period_start: string;
  period_end: string;
  property_count: number;
  expected_rent: number | string;
  confirmed_paid: number | string;
  outstanding: number | string;
  awaiting_confirmation: number | string;
  open_maintenance_count: number;
  upcoming_lease_expiry_count: number;
  generated_at: string;
  sent_at: string | null;
  whatsapp_message_id: string | null;
}): OwnerMonthlySummaryRow {
  return {
    id: row.id,
    orgId: row.org_id,
    ownerId: row.owner_id,
    ownerUserId: row.owner_user_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    propertyCount: row.property_count,
    expectedRent: Number(row.expected_rent),
    confirmedPaid: Number(row.confirmed_paid),
    outstanding: Number(row.outstanding),
    awaitingConfirmation: Number(row.awaiting_confirmation),
    openMaintenanceCount: row.open_maintenance_count,
    upcomingLeaseExpiryCount: row.upcoming_lease_expiry_count,
    generatedAt: row.generated_at,
    sentAt: row.sent_at,
    whatsappMessageId: row.whatsapp_message_id,
  };
}

/** Calendar-month period containing `date`, as YYYY-MM-DD bounds (inclusive). */
export function resolveCalendarMonthPeriod(date: Date): { periodStart: string; periodEnd: string } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

/** Every linked (owners.user_id set), contactable (phone on file) owner across every org. */
export async function resolveEligibleSummaryOwners(
  serviceClient: SupabaseClient,
): Promise<Array<{ ownerId: string; ownerUserId: string; orgId: string; phone: string }>> {
  const { data, error } = await serviceClient
    .from('owners')
    .select('id, user_id, org_id, phone')
    .eq('status', 'active')
    .not('user_id', 'is', null)
    .not('phone', 'is', null);
  if (error) throw new Error(`Failed to resolve summary-eligible owners: ${error.message}`);
  return (data ?? [])
    .filter((o): o is typeof o & { user_id: string; phone: string } => !!o.user_id && !!o.phone)
    .map((o) => ({ ownerId: o.id, ownerUserId: o.user_id, orgId: o.org_id, phone: o.phone }));
}

/**
 * Aggregates one owner's authorized-property-scoped monthly summary for `periodStart`..`periodEnd`.
 * Authorized scope = property_owners rows for this owner_id only (never another owner's
 * properties, even within the same org -- a shared property notifies each owner independently,
 * matching notifyOwnersOfPaymentReport()'s own per-owner fan-out in lib/paymentReports.ts).
 */
export async function computeOwnerMonthlySummary(
  serviceClient: SupabaseClient,
  input: {
    ownerId: string;
    ownerUserId: string;
    orgId: string;
    periodStart: string;
    periodEnd: string;
  },
): Promise<OwnerMonthlySummaryData> {
  const base: OwnerMonthlySummaryData = {
    ownerId: input.ownerId,
    ownerUserId: input.ownerUserId,
    orgId: input.orgId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    propertyCount: 0,
    expectedRent: 0,
    confirmedPaid: 0,
    outstanding: 0,
    awaitingConfirmation: 0,
    openMaintenanceCount: 0,
    upcomingLeaseExpiryCount: 0,
  };

  const { data: propertyOwnerRows, error: poError } = await serviceClient
    .from('property_owners')
    .select('property_id')
    .eq('owner_id', input.ownerId);
  if (poError) throw new Error(`Failed to resolve owner properties: ${poError.message}`);
  const propertyIds = (propertyOwnerRows ?? []).map((r) => r.property_id as string);
  if (propertyIds.length === 0) return base;

  const { data: unitRows, error: unitsError } = await serviceClient
    .from('units')
    .select('id')
    .in('property_id', propertyIds);
  if (unitsError) throw new Error(`Failed to resolve owner units: ${unitsError.message}`);
  const unitIds = (unitRows ?? []).map((u) => u.id as string);

  let expectedRent = 0;
  let confirmedPaid = 0;
  let upcomingLeaseExpiryCount = 0;

  if (unitIds.length > 0) {
    const { data: leaseRows, error: leaseError } = await serviceClient
      .from('leases')
      .select('id, end_date, status')
      .in('unit_id', unitIds);
    if (leaseError) throw new Error(`Failed to resolve owner leases: ${leaseError.message}`);
    const leaseIds = (leaseRows ?? []).map((l) => l.id as string);

    if (leaseIds.length > 0) {
      const { data: rentRows, error: rentError } = await serviceClient
        .from('rent_schedules')
        .select('amount, status')
        .in('lease_id', leaseIds)
        .gte('due_date', input.periodStart)
        .lte('due_date', input.periodEnd);
      if (rentError) throw new Error(`Failed to resolve rent schedules: ${rentError.message}`);
      for (const r of rentRows ?? []) {
        const amount = Number(r.amount);
        expectedRent += amount;
        if (r.status === 'paid') confirmedPaid += amount;
      }
    }

    const expiryWindowEnd = new Date(`${input.periodEnd}T00:00:00Z`);
    expiryWindowEnd.setUTCDate(expiryWindowEnd.getUTCDate() + 60);
    const expiryWindowEndStr = expiryWindowEnd.toISOString().slice(0, 10);
    upcomingLeaseExpiryCount = (leaseRows ?? []).filter(
      (l) =>
        l.status === 'active' &&
        !!l.end_date &&
        l.end_date >= input.periodStart &&
        l.end_date <= expiryWindowEndStr,
    ).length;
  }

  // Awaiting-confirmation bucket -- payment_reports.status = 'reported' only. Never 'confirmed'
  // (that would double-count against rent_schedules' own 'paid' status above) and never
  // 'rejected' (not a real payment at all).
  const { data: reportRows, error: reportError } = await serviceClient
    .from('payment_reports')
    .select('amount')
    .in('property_id', propertyIds)
    .eq('status', 'reported')
    .gte('payment_date', input.periodStart)
    .lte('payment_date', input.periodEnd);
  if (reportError) throw new Error(`Failed to resolve payment reports: ${reportError.message}`);
  const awaitingConfirmation = (reportRows ?? []).reduce((sum, r) => sum + Number(r.amount), 0);

  const { count: openMaintenanceCount, error: maintError } = await serviceClient
    .from('maintenance_tickets')
    .select('id', { count: 'exact', head: true })
    .in('property_id', propertyIds)
    .neq('status', 'completed');
  if (maintError) throw new Error(`Failed to resolve maintenance tickets: ${maintError.message}`);

  return {
    ...base,
    propertyCount: propertyIds.length,
    expectedRent,
    confirmedPaid,
    outstanding: Math.max(0, expectedRent - confirmedPaid),
    awaitingConfirmation,
    openMaintenanceCount: openMaintenanceCount ?? 0,
    upcomingLeaseExpiryCount,
  };
}

/**
 * Idempotent fetch-or-create: returns the existing snapshot for (ownerUserId, periodStart) if one
 * already exists (never recomputed -- see this file's header comment), else computes and inserts
 * one. A unique constraint on (owner_user_id, period_start) (migration 20260101000107) makes a
 * racing double-insert from two overlapping daily-jobs runs collapse to a single row: on a 23505
 * conflict this re-fetches and returns the row the other run just created rather than erroring.
 */
export async function getOrCreateOwnerMonthlySummary(
  serviceClient: SupabaseClient,
  input: {
    ownerId: string;
    ownerUserId: string;
    orgId: string;
    periodStart: string;
    periodEnd: string;
  },
): Promise<OwnerMonthlySummaryRow> {
  const { data: existing, error: fetchError } = await serviceClient
    .from('owner_property_summaries')
    .select('*')
    .eq('owner_user_id', input.ownerUserId)
    .eq('period_start', input.periodStart)
    .maybeSingle();
  if (fetchError) throw new Error(`Failed to fetch owner summary: ${fetchError.message}`);
  if (existing) return mapRow(existing);

  const computed = await computeOwnerMonthlySummary(serviceClient, input);

  const { data: inserted, error: insertError } = await serviceClient
    .from('owner_property_summaries')
    .insert({
      org_id: computed.orgId,
      owner_id: computed.ownerId,
      owner_user_id: computed.ownerUserId,
      period_start: computed.periodStart,
      period_end: computed.periodEnd,
      property_count: computed.propertyCount,
      expected_rent: computed.expectedRent,
      confirmed_paid: computed.confirmedPaid,
      outstanding: computed.outstanding,
      awaiting_confirmation: computed.awaitingConfirmation,
      open_maintenance_count: computed.openMaintenanceCount,
      upcoming_lease_expiry_count: computed.upcomingLeaseExpiryCount,
    })
    .select('*')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: raced, error: racedError } = await serviceClient
        .from('owner_property_summaries')
        .select('*')
        .eq('owner_user_id', input.ownerUserId)
        .eq('period_start', input.periodStart)
        .single();
      if (racedError)
        throw new Error(`Failed to fetch racing owner summary: ${racedError.message}`);
      return mapRow(raced);
    }
    throw new Error(`Failed to create owner summary: ${insertError.message}`);
  }

  return mapRow(inserted);
}

export async function markOwnerMonthlySummarySent(
  serviceClient: SupabaseClient,
  input: { summaryId: string; whatsappMessageId: string },
): Promise<void> {
  const { error } = await serviceClient
    .from('owner_property_summaries')
    .update({ sent_at: new Date().toISOString(), whatsapp_message_id: input.whatsappMessageId })
    .eq('id', input.summaryId);
  if (error) throw new Error(`Failed to mark owner summary sent: ${error.message}`);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatSummaryMonthLabel(periodStart: string): string {
  const [year, month] = periodStart.split('-').map(Number);
  return `${MONTH_NAMES[(month ?? 1) - 1]} ${year}`;
}
