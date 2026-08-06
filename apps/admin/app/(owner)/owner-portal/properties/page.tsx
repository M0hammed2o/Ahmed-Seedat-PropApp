import { Building2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

interface OwnerPropertyRow {
  id: string;
  nickname: string;
  fullAddress: string;
  propertyType: string;
  status: string;
  ownershipPct: number | null;
}

const DEMO_PROPERTIES: OwnerPropertyRow[] = [
  {
    id: 'demo-owner-property-1',
    nickname: 'Oakwood Apartments',
    fullAddress: '12 Oak Street, Claremont, Cape Town, 7708',
    propertyType: 'apartment',
    status: 'active',
    ownershipPct: 50,
  },
];

/**
 * GET /owner-portal/properties (Phase 5, commercial-launch execution plan). RLS
 * (`properties_select_staff_or_owner`, migration 20260101000072) already scopes this to exactly
 * the properties the caller holds an 'owner'-role property_access grant on -- this page just
 * renders whatever it returns, same plain-RLS-protected-read pattern as every other portal list
 * page in this codebase. `ownershipPct` comes from `property_owners` (a real join, not derived) --
 * shown here because "ownership percentage" is explicit V1 scope for this page (execution plan
 * Phase 5), unlike anywhere in the staff-facing UI, which never surfaces it (found stale during
 * the earlier architecture review, TECHNICAL_DEBT_REGISTER.md-adjacent finding this session).
 */
export default async function OwnerPropertiesPage() {
  const properties = ADMIN_DEMO_MODE ? DEMO_PROPERTIES : await loadOwnerProperties();

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="My Properties" subtitle="Properties you hold an ownership share in." />

      {properties.length === 0 ? (
        <div className="rounded-card border border-light-border bg-light-surfaceRaised dark:border-dark-border dark:bg-dark-surfaceRaised">
          <EmptyState
            icon={<Building2 size={20} aria-hidden="true" />}
            title="No properties yet"
            description="Properties you own a share of will appear here once your property manager records your ownership."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
              <tr>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Property
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Address
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Type
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  My share
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-light-border last:border-b-0 dark:border-dark-border"
                >
                  <td className="px-4 py-3 font-medium text-light-textPrimary dark:text-dark-textPrimary">
                    {p.nickname}
                  </td>
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                    {p.fullAddress}
                  </td>
                  <td className="px-4 py-3 capitalize text-light-textPrimary dark:text-dark-textPrimary">
                    {p.propertyType}
                  </td>
                  <td className="px-4 py-3 tabular text-light-textPrimary dark:text-dark-textPrimary">
                    {p.ownershipPct === null ? '—' : `${p.ownershipPct}%`}
                  </td>
                  <td className="px-4 py-3 capitalize text-light-textPrimary dark:text-dark-textPrimary">
                    {p.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function loadOwnerProperties(): Promise<OwnerPropertyRow[]> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // The caller's own owner record(s) -- an owner can in principle have more than one `owners` row
  // (one per org, same edge case resolveOwnerSession() documents); ownership_pct is looked up per
  // owner_id below, so this covers that correctly rather than assuming exactly one.
  const { data: ownerRows, error: ownerError } = await supabase
    .from('owners')
    .select('id')
    .eq('user_id', user.id);
  if (ownerError) throw new Error(`Failed to load owner record: ${ownerError.message}`);
  const ownerIds = (ownerRows ?? []).map((o) => o.id as string);
  if (ownerIds.length === 0) return [];

  const { data: shares, error: sharesError } = await supabase
    .from('property_owners')
    .select('property_id, ownership_pct')
    .in('owner_id', ownerIds);
  if (sharesError) throw new Error(`Failed to load ownership shares: ${sharesError.message}`);

  const pctByProperty = new Map<string, number>();
  for (const s of shares ?? []) pctByProperty.set(s.property_id as string, Number(s.ownership_pct));

  const { data: properties, error: propertiesError } = await supabase
    .from('properties')
    .select('id, nickname, full_address, property_type, status')
    .order('nickname', { ascending: true });
  if (propertiesError) throw new Error(`Failed to load properties: ${propertiesError.message}`);

  return (properties ?? []).map((p) => ({
    id: p.id as string,
    nickname: p.nickname as string,
    fullAddress: p.full_address as string,
    propertyType: p.property_type as string,
    status: p.status as string,
    ownershipPct: pctByProperty.get(p.id as string) ?? null,
  }));
}
