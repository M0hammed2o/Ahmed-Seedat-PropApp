import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Invoice paid/balance at production scale, against REAL local Supabase (2026-09-14). The confirmed
// production defect: an organisation with ~432 invoices showed every invoice as Paid R0 -- e.g.
// INV-001972, R9,500 with a non-reversed R9,500 payment, reported Paid R0 / Balance R9,500 -- because
// loadInvoicesWithBalances() fetched payments with one `.in('invoice_id', <every id>)` request and
// treated a failed request as "no payments". This builds the same shape (hundreds of rent invoices,
// almost all paid) and proves both the shared function and the Android-facing API routes.

let mockAuthorizationHeader: string | null = null;
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null,
  }),
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
}));

const SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = 'TestPassw0rd!23';

const { loadInvoicesWithBalances } = await import('@/lib/invoicing');
const { GET: listInvoices } = await import('@/app/api/v1/invoices/route');
const { GET: getInvoice } = await import('@/app/api/v1/invoices/[id]/route');

let supabaseReachable = false;
try {
  supabaseReachable = (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

const LEASES = 12;
const MONTHS_PER_LEASE = 37; // 444 rent invoices -- more than the 432 of the affected organisation
const BULK_AMOUNT = 9000;

function monthStart(offset: number): string {
  const d = new Date(Date.UTC(2023, 7, 1));
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 10);
}

describeIfSupabase('invoice paid/balance at production scale (real local Supabase)', () => {
  const service: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = randomUUID().slice(0, 8);
  let orgId: string;
  let principalId: string;
  let principal: SupabaseClient;
  let accessToken: string;
  const special: Record<'fullyPaid' | 'partial' | 'unpaid' | 'reversed', string> = {
    fullyPaid: '',
    partial: '',
    unpaid: '',
    reversed: '',
  };

  async function must<T>(
    label: string,
    p: PromiseLike<{ data: T; error: { message: string } | null }>,
  ) {
    const { data, error } = await p;
    if (error) throw new Error(`${label}: ${error.message}`);
    return data as NonNullable<T>;
  }

  beforeAll(async () => {
    const email = `invoice-balances-${suffix}@test.propertyvault.example`;
    const created = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    principalId = created.data.user!.id;

    orgId = (
      await must(
        'org',
        service
          .from('organizations')
          .insert({
            legal_name: `Invoice Balances Vitest ${suffix}`,
            org_type: 'agency',
            status: 'active',
          })
          .select('id')
          .single(),
      )
    ).id;
    await must(
      'member',
      service.from('organization_members').insert({
        org_id: orgId,
        user_id: principalId,
        role: 'principal',
        status: 'active',
        joined_at: new Date().toISOString(),
      }),
    );
    const propertyId = (
      await must(
        'property',
        service
          .from('properties')
          .insert({
            org_id: orgId,
            nickname: 'Scale Court',
            address_line1: '1 Test St',
            city: 'Durban',
          })
          .select('id')
          .single(),
      )
    ).id;

    const invoices: Record<string, unknown>[] = [];
    const schedules: Record<string, unknown>[] = [];
    for (let l = 0; l < LEASES; l += 1) {
      const unitId = (
        await must(
          'unit',
          service
            .from('units')
            .insert({ org_id: orgId, property_id: propertyId, unit_label: `U${l}` })
            .select('id')
            .single(),
        )
      ).id;
      const tenantId = (
        await must(
          'tenant',
          service
            .from('tenants')
            .insert({ org_id: orgId, full_name: `Tenant ${l}` })
            .select('id')
            .single(),
        )
      ).id;
      const leaseId = (
        await must(
          'lease',
          service
            .from('leases')
            .insert({
              org_id: orgId,
              unit_id: unitId,
              start_date: '2023-08-01',
              rent_amount: BULK_AMOUNT,
              status: 'active',
            })
            .select('id')
            .single(),
        )
      ).id;
      await must(
        'lease_tenant',
        service
          .from('lease_tenants')
          .insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true }),
      );
      for (let m = 0; m < MONTHS_PER_LEASE; m += 1) {
        const period = monthStart(m);
        schedules.push({
          org_id: orgId,
          lease_id: leaseId,
          due_date: period,
          amount: BULK_AMOUNT,
          status: 'invoiced',
        });
        invoices.push({
          org_id: orgId,
          lease_id: leaseId,
          tenant_id: tenantId,
          period,
          amount: BULK_AMOUNT,
          status: 'issued',
          issued_at: `${period}T08:00:00Z`,
          source: 'rent_schedule',
          invoice_number: `VT-${suffix}-${l}-${m}`,
        });
      }
    }
    for (let i = 0; i < schedules.length; i += 200)
      await must('schedules', service.from('rent_schedules').insert(schedules.slice(i, i + 200)));
    const inserted: { id: string; tenant_id: string; invoice_number: string }[] = [];
    for (let i = 0; i < invoices.length; i += 200) {
      inserted.push(
        ...(await must(
          'invoices',
          service
            .from('invoices')
            .insert(invoices.slice(i, i + 200))
            .select('id, tenant_id, invoice_number'),
        )),
      );
    }

    // The four cases that matter individually; every other invoice is fully paid, like production.
    const byNumber = new Map(inserted.map((r) => [r.invoice_number, r]));
    const pick = (l: number, m: number) => byNumber.get(`VT-${suffix}-${l}-${m}`)!;
    special.fullyPaid = pick(0, 36).id; // the INV-001972 twin: R9,500 invoice, one R9,500 payment
    special.partial = pick(1, 36).id;
    special.unpaid = pick(2, 36).id;
    special.reversed = pick(3, 36).id;
    await must(
      'fullyPaid amount',
      service.from('invoices').update({ amount: 9500 }).eq('id', special.fullyPaid),
    );

    const payments: Record<string, unknown>[] = [];
    for (const row of inserted) {
      const base = {
        invoice_id: row.id,
        org_id: orgId,
        tenant_id: row.tenant_id,
        paid_at: '2026-09-04T10:00:00Z',
        method: 'card',
      };
      if (row.id === special.unpaid) continue;
      if (row.id === special.fullyPaid)
        payments.push({ ...base, amount: 9500, reference: 'RENT-Unit3-202609' });
      else if (row.id === special.partial) payments.push({ ...base, amount: 6000 });
      else if (row.id === special.reversed)
        payments.push({
          ...base,
          amount: BULK_AMOUNT,
          reversed_at: '2026-09-05T10:00:00Z',
          reversed_by_user_id: principalId,
          reversal_reason: 'bounced',
        });
      else payments.push({ ...base, amount: BULK_AMOUNT });
    }
    for (let i = 0; i < payments.length; i += 200)
      await must('payments', service.from('invoice_payments').insert(payments.slice(i, i + 200)));

    principal = createClient(SUPABASE_URL, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signIn = await principal.auth.signInWithPassword({ email, password: PASSWORD });
    if (signIn.error) throw signIn.error;
    accessToken = signIn.data.session!.access_token;
  }, 180_000);

  afterAll(async () => {
    mockAuthorizationHeader = null;
    if (orgId) await service.from('organizations').delete().eq('id', orgId);
    if (principalId) await service.auth.admin.deleteUser(principalId);
  });

  it('computes every invoice in a 444-invoice organisation from its own payments', async () => {
    const all = await loadInvoicesWithBalances(principal);
    const mine = all.filter((i) => i.invoiceNumber.startsWith(`VT-${suffix}-`));
    expect(mine).toHaveLength(LEASES * MONTHS_PER_LEASE);
    const byId = new Map(mine.map((i) => [i.id, i]));

    const fullyPaid = byId.get(special.fullyPaid)!;
    expect({
      amount: fullyPaid.amount,
      paid: fullyPaid.paid,
      balance: fullyPaid.balance,
      status: fullyPaid.displayStatus,
    }).toEqual({
      amount: 9500,
      paid: 9500,
      balance: 0,
      status: 'Paid',
    });
    const partial = byId.get(special.partial)!;
    expect({ paid: partial.paid, balance: partial.balance }).toEqual({ paid: 6000, balance: 3000 });
    const unpaid = byId.get(special.unpaid)!;
    expect({ paid: unpaid.paid, balance: unpaid.balance }).toEqual({
      paid: 0,
      balance: BULK_AMOUNT,
    });
    const reversed = byId.get(special.reversed)!;
    expect({ paid: reversed.paid, balance: reversed.balance }).toEqual({
      paid: 0,
      balance: BULK_AMOUNT,
    });

    const others = mine.filter((i) => !Object.values(special).includes(i.id));
    expect(
      others.every((i) => i.paid === BULK_AMOUNT && i.balance === 0 && i.displayStatus === 'Paid'),
    ).toBe(true);
  }, 60_000);

  it('GET /api/v1/invoices and GET /api/v1/invoices/:id report the same correct figures (the Android calls)', async () => {
    mockAuthorizationHeader = `Bearer ${accessToken}`;
    const list = await listInvoices();
    expect(list.status).toBe(200);
    const listed = (
      (await list.json()).invoices as { id: string; paid: number; balance: number }[]
    ).filter((i) => Object.values(special).includes(i.id));
    const fromList = Object.fromEntries(
      listed.map((i) => [i.id, { paid: i.paid, balance: i.balance }]),
    );

    for (const [name, id] of Object.entries(special)) {
      const detail = await getInvoice(new NextRequest(`http://localhost/api/v1/invoices/${id}`), {
        params: Promise.resolve({ id }),
      });
      expect(detail.status, name).toBe(200);
      const body = await detail.json();
      expect({ paid: body.paid, balance: body.balance }, name).toEqual(fromList[id]);
    }
    expect(fromList[special.fullyPaid]).toEqual({ paid: 9500, balance: 0 });
    expect(fromList[special.partial]).toEqual({ paid: 6000, balance: 3000 });
    expect(fromList[special.unpaid]).toEqual({ paid: 0, balance: BULK_AMOUNT });
    expect(fromList[special.reversed]).toEqual({ paid: 0, balance: BULK_AMOUNT });
  }, 60_000);
});
