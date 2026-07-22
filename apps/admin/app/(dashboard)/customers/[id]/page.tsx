import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { DEMO_CUSTOMERS } from '@/lib/demo/adminMockData';

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('read_only_admin');
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    const customer = DEMO_CUSTOMERS.find((c) => c.id === id);
    if (!customer) notFound();

    return (
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            {customer.displayName}
          </h1>
          <span className="rounded-full border border-light-accent px-3 py-1 text-xs font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
            Demo data
          </span>
        </div>
        <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
          {customer.email}
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Registered</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {new Date(customer.createdAt).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Last active</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {new Date(customer.lastActiveAt).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Properties</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {customer.propertyCount}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Documents</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {customer.documentCount}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Storage used</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {(customer.storageUsedMb / 1024).toFixed(2)}GB
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Subscription</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {customer.subscriptionStatus.replace('_', ' ')}
            </dd>
          </div>
        </dl>

        <p className="mt-8 text-xs text-light-textMuted dark:text-dark-textMuted">
          Suspend/reactivate, admin notes, and raw document access are architected
          (ADMIN_DASHBOARD.md, SECURITY.md) but not yet wired to a mutating action — tracked in
          TODO.md.
        </p>
      </div>
    );
  }

  const supabase = getServiceRoleClient();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
  if (!profile) notFound();

  const [{ count: propertyCount }, { count: documentCount }, { data: subscription }] =
    await Promise.all([
      supabase
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('owner_user_id', id),
      supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('owner_user_id', id),
      supabase.from('subscriptions').select('*').eq('owner_user_id', id).maybeSingle(),
    ]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        {profile.display_name || 'Customer'}
      </h1>
      <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">{profile.id}</p>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Registered</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {new Date(profile.created_at).toLocaleDateString()}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Properties</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {propertyCount ?? 0}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Documents</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {documentCount ?? 0}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Subscription</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {subscription?.status ?? 'unknown'}
          </dd>
        </div>
      </dl>

      <p className="mt-8 text-xs text-light-textMuted dark:text-dark-textMuted">
        Suspend/reactivate, admin notes, and raw document access are architected
        (ADMIN_DASHBOARD.md, SECURITY.md) but not yet wired to a mutating action in Phase 1 —
        tracked in TODO.md.
      </p>
    </div>
  );
}
