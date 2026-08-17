import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Building2, Banknote, Wrench, Clock, CircleDollarSign } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolveOwnerSession } from '@/lib/ownerSession';
import { formatSummaryMonthLabel } from '@/lib/ownerSummary';

type RouteParams = { params: Promise<{ id: string }> };

function currency(n: number): string {
  return `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface SummaryRow {
  id: string;
  period_start: string;
  property_count: number;
  expected_rent: number;
  confirmed_paid: number;
  outstanding: number;
  awaiting_confirmation: number;
  open_maintenance_count: number;
  upcoming_lease_expiry_count: number;
  generated_at: string;
  sent_at: string | null;
}

/**
 * GET /owner-portal/summary/:id -- WhatsApp V1 final pre-production pass, Phase 6 (WORKLOG.md
 * this date). The real, authenticated destination behind owner_monthly_property_summary's
 * secure link (lib/systemJobs.ts's runOwnerMonthlySummaryJob, `${getAppUrl()}/owner-portal/
 * summary/${summary.id}`). RLS (owner_property_summaries_select_owner_self, migration
 * 20260101000107) is the real access control -- an owner querying another owner's summary id
 * gets zero rows back, rendered here as a plain 404, never a leaked cross-owner number.
 */
export default async function OwnerMonthlySummaryDetailPage({ params }: RouteParams) {
  const { id } = await params;

  const session = await resolveOwnerSession();
  if (!session) redirect('/login');

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('owner_property_summaries')
    .select(
      'id, period_start, property_count, expected_rent, confirmed_paid, outstanding, awaiting_confirmation, open_maintenance_count, upcoming_lease_expiry_count, generated_at, sent_at',
    )
    .eq('id', id)
    .maybeSingle<SummaryRow>();
  if (error) throw new Error(`Failed to load monthly summary: ${error.message}`);
  if (!data) notFound();

  const monthLabel = formatSummaryMonthLabel(data.period_start);

  return (
    <div className="space-y-5 animate-rise">
      <div>
        <Link
          href="/owner-portal"
          className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
        >
          ← Back to home
        </Link>
        <div className="mt-2">
          <PageHeader
            title={`${monthLabel} property summary`}
            subtitle={`Across ${data.property_count} propert${data.property_count === 1 ? 'y' : 'ies'} you own a share of.`}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AdminMetricCard
          icon={<Banknote className="h-4 w-4" aria-hidden="true" />}
          label="Expected rent"
          value={currency(data.expected_rent)}
        />
        <AdminMetricCard
          icon={<CircleDollarSign className="h-4 w-4" aria-hidden="true" />}
          label="Confirmed paid"
          value={currency(data.confirmed_paid)}
          hint="Rent schedules marked paid in your accounting records."
        />
        <AdminMetricCard
          icon={<Clock className="h-4 w-4" aria-hidden="true" />}
          label="Outstanding"
          value={currency(data.outstanding)}
        />
        <AdminMetricCard
          icon={<Clock className="h-4 w-4" aria-hidden="true" />}
          label="Awaiting confirmation"
          value={currency(data.awaiting_confirmation)}
          hint="Tenant-reported payments not yet confirmed by staff -- not counted as paid above."
        />
        <AdminMetricCard
          icon={<Wrench className="h-4 w-4" aria-hidden="true" />}
          label="Open maintenance"
          value={data.open_maintenance_count}
        />
        <AdminMetricCard
          icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
          label="Upcoming lease expiries"
          value={data.upcoming_lease_expiry_count}
          hint="Within the next 60 days."
        />
      </div>

      <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
        Generated {new Date(data.generated_at).toLocaleDateString('en-ZA')}
        {data.sent_at
          ? ` · sent via WhatsApp ${new Date(data.sent_at).toLocaleDateString('en-ZA')}`
          : null}
      </p>
    </div>
  );
}
