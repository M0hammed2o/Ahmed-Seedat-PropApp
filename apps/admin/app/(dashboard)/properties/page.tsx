import Link from 'next/link';
import type { Property } from '@propvault/types';
import { PropertiesTable } from '@/components/tables/PropertiesTable';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPropertyRow } from '@/lib/portfolio';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_PROPERTIES: Property[] = [
  {
    id: 'demo-property-1',
    orgId: 'demo-org-1',
    nickname: 'Sea Point Apartment',
    fullAddress: '12 Main Road, Sea Point, Cape Town, 8005',
    addressLine1: '12 Main Road',
    addressLine2: null,
    suburb: 'Sea Point',
    city: 'Cape Town',
    province: 'Western Cape',
    postalCode: '8005',
    country: 'ZA',
    propertyType: 'apartment',
    municipalAccountNumber: null,
    notes: null,
    imagePath: null,
    status: 'active',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  },
];

/**
 * GET /properties -- first page in the (dashboard) client-org-facing route group (TASKS.md M20).
 * Queries directly through the caller's own session-bound client, same "plain RLS-protected
 * read" pattern GET /api/v1/properties documents (RLS already scopes to the caller's org
 * memberships) -- no org_id filter applied here, which is correct for a single-org user and a
 * known, honest simplification for a multi-org user (shows properties across every org they
 * belong to, combined) until an org switcher exists.
 */
export default async function PropertiesPage() {
  const properties: Property[] = ADMIN_DEMO_MODE
    ? DEMO_PROPERTIES
    : await (async () => {
        const supabase = await getServerSupabaseClient();
        const { data, error } = await supabase
          .from('properties')
          .select('*')
          .eq('status', 'active')
          .order('created_at', { ascending: false });
        if (error) throw new Error(`Failed to load properties: ${error.message}`);
        return (data ?? []).map(mapPropertyRow);
      })();

  const addAction = (
    <Link href="/properties/new">
      <Button variant="primary" size="sm">
        + Add property
      </Button>
    </Link>
  );

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Properties"
        subtitle={`${properties.length} ${properties.length === 1 ? 'property' : 'properties'} in your portfolio.`}
        actions={properties.length > 0 ? addAction : undefined}
      />
      <PropertiesTable data={properties} emptyAction={addAction} />
    </div>
  );
}
