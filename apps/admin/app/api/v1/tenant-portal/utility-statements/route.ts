import { NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolveTenantSession } from '@/lib/tenantSession';
import { serverError } from '@/lib/smartUtility/http';

/**
 * GET /api/v1/tenant-portal/utility-statements — the signed-in tenant's APPROVED (or sent) utility statements
 * (docs/HYBRID_UTILITIES_ARCHITECTURE.md §F). Two independent guards: the tenant is resolved server-side (never a
 * client-supplied id), and RLS utility_statements_select_tenant_self only exposes approved/sent statements of
 * leases the caller is a tenant on — drafts and owner reports are never returned. Used by web and Android/iOS.
 */
export async function GET() {
  const supabase = await getServerSupabaseClient();
  const session = await resolveTenantSession();
  if (!session) {
    return NextResponse.json({ error: { code: 'unauthenticated', message: 'Sign in required.' } }, { status: 401 });
  }
  const { data, error } = await supabase
    .from('utility_statements')
    .select('id, property_id, period_start, period_end, status, approved_at, sent_at, snapshot')
    .eq('audience', 'tenant')
    .eq('tenant_id', session.tenantId)
    .in('status', ['approved', 'sent'])
    .order('period_start', { ascending: false })
    .limit(36);
  if (error) return serverError('utility_statements_failed', 'Could not load your utility statements.', 'tenant_portal.utility_statements', error);

  type Snapshot = {
    unitLabel?: string | null;
    property?: { name?: string };
    period?: { start: string; end: string };
    totals?: { excl: number | null; vat: number | null; total: number };
    lines?: {
      utility: string;
      description: string;
      segment: string;
      opening: number | null;
      closing: number | null;
      consumption: number | null;
      unit: string;
      basis: string;
      tariff: string | null;
      total: number;
      creditApplied: number;
    }[];
    notes?: string[];
  };
  return NextResponse.json({
    statements: (data ?? []).map((s) => {
      const snap = (s.snapshot ?? {}) as Snapshot;
      return {
        id: s.id,
        propertyId: s.property_id,
        propertyName: snap.property?.name ?? null,
        unitLabel: snap.unitLabel ?? null,
        periodStart: snap.period?.start ?? s.period_start,
        periodEnd: snap.period?.end ?? s.period_end,
        status: s.status,
        total: snap.totals?.total ?? 0,
        vat: snap.totals?.vat ?? null,
        lines: (snap.lines ?? []).map((l) => ({
          utility: l.utility,
          description: l.description,
          segment: l.segment,
          opening: l.opening,
          closing: l.closing,
          consumption: l.consumption,
          unit: l.unit,
          basis: l.basis,
          tariff: l.tariff,
          total: l.total,
          creditApplied: l.creditApplied,
        })),
        notes: snap.notes ?? [],
        pdfPath: `/api/v1/properties/${s.property_id}/utility-statements/${s.id}`,
      };
    }),
  });
}
