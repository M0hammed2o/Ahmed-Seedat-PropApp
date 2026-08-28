import { redirect } from 'next/navigation';
import { BankTransactionForm } from '@/components/accounting/BankTransactionForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import {
  resolvePortalSession,
  findActiveMembership,
  canPostAccountingRecords,
} from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export default async function NewBankTransactionPage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <BankTransactionForm
        orgId="demo-org-1"
        bankAccounts={[{ id: 'demo-bank-account-1', bankName: 'FNB Business' }]}
        properties={[{ id: 'demo-property-1', nickname: 'Sea Point Apartment' }]}
        units={[{ id: 'demo-unit-1', unitLabel: 'Unit 1', propertyId: 'demo-property-1' }]}
        tenants={[{ id: 'demo-tenant-1', fullName: 'Demo Tenant' }]}
        vendors={[{ id: 'demo-vendor-1', name: 'Demo Vendor' }]}
        evidenceCategoryId="demo-category-1"
      />
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');

  const membership = findActiveMembership(session, activeOrg.orgId);
  if (!membership || !canPostAccountingRecords(membership.role))
    redirect('/accounting/bank-transactions');

  const supabase = await getServerSupabaseClient();
  const [
    bankAccountsResult,
    propertiesResult,
    unitsResult,
    tenantsResult,
    vendorsResult,
    categoryResult,
  ] = await Promise.all([
    supabase
      .from('bank_accounts')
      .select('id, bank_name')
      .eq('org_id', activeOrg.orgId)
      .eq('is_active', true)
      .order('bank_name', { ascending: true }),
    supabase
      .from('properties')
      .select('id, nickname')
      .eq('org_id', activeOrg.orgId)
      .eq('status', 'active')
      .order('nickname', { ascending: true }),
    supabase
      .from('units')
      .select('id, unit_label, property_id')
      .eq('org_id', activeOrg.orgId)
      .order('unit_label', { ascending: true }),
    supabase
      .from('tenants')
      .select('id, full_name')
      .eq('org_id', activeOrg.orgId)
      .order('full_name', { ascending: true }),
    supabase
      .from('vendors')
      .select('id, name')
      .eq('org_id', activeOrg.orgId)
      .eq('status', 'active')
      .order('name', { ascending: true }),
    supabase.from('document_categories').select('id').eq('slug', 'proof_of_payment').maybeSingle(),
  ]);
  if (bankAccountsResult.error)
    throw new Error(`Failed to load bank accounts: ${bankAccountsResult.error.message}`);
  if (propertiesResult.error)
    throw new Error(`Failed to load properties: ${propertiesResult.error.message}`);
  if (unitsResult.error) throw new Error(`Failed to load units: ${unitsResult.error.message}`);
  if (tenantsResult.error) throw new Error(`Failed to load tenants: ${tenantsResult.error.message}`);
  if (vendorsResult.error) throw new Error(`Failed to load vendors: ${vendorsResult.error.message}`);

  return (
    <BankTransactionForm
      orgId={activeOrg.orgId}
      bankAccounts={(bankAccountsResult.data ?? []).map((a) => ({
        id: a.id,
        bankName: a.bank_name,
      }))}
      properties={propertiesResult.data ?? []}
      units={(unitsResult.data ?? []).map((u) => ({
        id: u.id,
        unitLabel: u.unit_label,
        propertyId: u.property_id,
      }))}
      tenants={(tenantsResult.data ?? []).map((t) => ({ id: t.id, fullName: t.full_name }))}
      vendors={vendorsResult.data ?? []}
      evidenceCategoryId={categoryResult.data?.id ?? null}
    />
  );
}
