import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// GET /api/v1/properties/:id/utility-sources — every source's latest level is reported even when another sensor on the
// same property is busy. Before the fix, one shared query returned the newest 1 000 rows across all sources (the API
// row cap), so a 15-minute tank sensor (~1 100 rows in 7 days here) crowded out the others: their latest looked missing.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let mockAuthorizationHeader: string | null = null;
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (n: string) => (n.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null) }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, getAll: () => [] }),
}));
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { GET } = await import('../route');

const URL_ = 'http://127.0.0.1:54321';
let reachable = false;
try {
  reachable = (await fetch(`${URL_}/auth/v1/health`)).ok;
} catch {
  reachable = false;
}
const d = reachable ? describe : describe.skip;
const service: SupabaseClient = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

d('utility sources: latest level per source (real local Supabase)', () => {
  it('a busy sensor never hides another source\'s latest reading', async () => {
    const sfx = Date.now();
    const email = `src-latest-${sfx}@propertyvault.example`;
    const userId = (await service.auth.admin.createUser({ email, password: 'TestPassw0rd!23', email_confirm: true })).data.user!.id;
    const orgId = (await service.from('organizations').insert({ legal_name: `SRC ${sfx}`, org_type: 'agency', utilities_enabled: true }).select('id').single()).data!.id as string;
    await service.from('organization_members').insert({ org_id: orgId, user_id: userId, role: 'manager', status: 'active', joined_at: new Date().toISOString(), property_access_mode: 'all' });
    const propertyId = (await service.from('properties').insert({ org_id: orgId, nickname: 'SRC', address_line1: '1', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' }).select('id').single()).data!.id as string;
    const busy = (await service.from('utility_supply_sources').insert({ org_id: orgId, property_id: propertyId, utility_type: 'water', source_type: 'storage_tank', name: 'Busy tank', capacity_value: 5000, capacity_unit: 'litres' }).select('id').single()).data!.id as string;
    const quiet = (await service.from('utility_supply_sources').insert({ org_id: orgId, property_id: propertyId, utility_type: 'water', source_type: 'storage_tank', name: 'Quiet tank', capacity_value: 2000, capacity_unit: 'litres' }).select('id').single()).data!.id as string;

    // Quiet tank: one reading 3 days ago. Busy tank: 1 100 readings over the last ~11 hours (newer than the quiet one).
    const { error: e1 } = await service.from('utility_source_readings').insert({ org_id: orgId, property_id: propertyId, source_id: quiet, metric: 'tank_level_pct', read_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), value: 42, source: 'manual' });
    expect(e1).toBeNull();
    const rows = Array.from({ length: 1100 }, (_, i) => ({ org_id: orgId, property_id: propertyId, source_id: busy, metric: 'tank_level_pct', read_at: new Date(Date.now() - (i + 1) * 36_000).toISOString(), value: 50 + (i % 10), source: 'device' }));
    const { error: e2 } = await service.from('utility_source_readings').insert(rows);
    expect(e2).toBeNull();

    const token = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'TestPassw0rd!23' }) })).json()).access_token as string;
    mockAuthorizationHeader = `Bearer ${token}`;
    const res = await GET(new NextRequest('http://localhost/x'), { params: Promise.resolve({ id: propertyId }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sources: { id: string; latest: { metric: string; value: number }[] }[] };
    expect(body.sources.find((s) => s.id === quiet)!.latest).toEqual([expect.objectContaining({ metric: 'tank_level_pct', value: 42 })]);
    expect(body.sources.find((s) => s.id === busy)!.latest).toEqual([expect.objectContaining({ metric: 'tank_level_pct', value: 50 })]);
  });
});
