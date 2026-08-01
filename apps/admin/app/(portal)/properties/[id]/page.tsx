import { notFound } from 'next/navigation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPropertyRow } from '@/lib/portfolio';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

export default async function PropertyDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-property-1') notFound();
    return (
      <div>
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Sea Point Apartment</h1>
        <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
          12 Main Road, Sea Point, Cape Town, 8005
        </p>
      </div>
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load property: ${error.message}`);
  if (!data) notFound();
  const property = mapPropertyRow(data);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">{property.nickname}</h1>
        <span className="text-xs font-medium capitalize text-light-textSecondary dark:text-dark-textSecondary">
          {property.status}
        </span>
      </div>
      <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">{property.fullAddress}</p>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Type</dt>
          <dd className="capitalize text-light-textPrimary dark:text-dark-textPrimary">
            {property.propertyType.replace('_', ' ')}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">City</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">{property.city}</dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Province</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">{property.province ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Municipal account</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {property.municipalAccountNumber ?? '—'}
          </dd>
        </div>
      </dl>

      {property.notes ? (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">Notes</h2>
          <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">{property.notes}</p>
        </div>
      ) : null}

      <p className="mt-8 text-xs text-light-textMuted dark:text-dark-textMuted">
        Units, leases, tenants, and maintenance for this property are built at the API layer
        (TASKS.md M6-M13) but not yet wired into this page — first vertical slice of the (portal)
        route group, more modules follow the same pattern.
      </p>
    </div>
  );
}
