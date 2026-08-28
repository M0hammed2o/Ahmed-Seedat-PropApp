import { redirect } from 'next/navigation';
import { ExpenseForm } from '@/components/accounting/ExpenseForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import {
  resolvePortalSession,
  findActiveMembership,
  canPostAccountingRecords,
} from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export default async function NewExpensePage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <ExpenseForm
        orgId="demo-org-1"
        properties={[{ id: 'demo-property-1', nickname: 'Sea Point Apartment' }]}
      />
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');

  // accountant+ per PERMISSIONS.md's Accounting (post) column -- a stricter gate than every other
  // create form this milestone, which only required agent+.
  const membership = findActiveMembership(session, activeOrg.orgId);
  if (!membership || !canPostAccountingRecords(membership.role)) redirect('/accounting/expenses');

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('properties')
    .select('id, nickname')
    .eq('org_id', activeOrg.orgId)
    .eq('status', 'active')
    .order('nickname', { ascending: true });
  if (error) throw new Error(`Failed to load properties: ${error.message}`);

  // V1 launch-completion pass: units across the whole org (client-side filtered by whichever
  // property ExpenseForm's own picker selects, same NewApplicationPicker.tsx pattern), the org's
  // active vendors (existing Vendors module, reused as-is), and the 'receipt' document category
  // id the optional evidence upload tags its document with.
  const [{ data: units, error: unitsError }, { data: vendors, error: vendorsError }, { data: receiptCategory }] =
    await Promise.all([
      supabase
        .from('units')
        .select('id, property_id, unit_label')
        .eq('org_id', activeOrg.orgId)
        .order('unit_label', { ascending: true }),
      supabase
        .from('vendors')
        .select('id, name')
        .eq('org_id', activeOrg.orgId)
        .eq('status', 'active')
        .order('name', { ascending: true }),
      supabase.from('document_categories').select('id').eq('slug', 'receipt').maybeSingle(),
    ]);
  if (unitsError) throw new Error(`Failed to load units: ${unitsError.message}`);
  if (vendorsError) throw new Error(`Failed to load vendors: ${vendorsError.message}`);

  return (
    <ExpenseForm
      orgId={activeOrg.orgId}
      properties={data ?? []}
      units={(units ?? []).map((u) => ({
        id: u.id,
        propertyId: u.property_id,
        unitLabel: u.unit_label,
      }))}
      vendors={(vendors ?? []).map((v) => ({ id: v.id, label: v.name }))}
      receiptCategoryId={receiptCategory?.id ?? null}
    />
  );
}
