import { describe, expect, it, vi } from 'vitest';
import type { TariffRow } from '../billing';

vi.mock('server-only', () => ({}));
const billing = await import('../billing');
const providers = await import('../providers');

// Unit checks for the 2026-10-10 production-readiness fixes (docs/UTILITIES_FINANCIAL_VALIDATION.md,
// docs/UTILITIES_SECURITY_FINDINGS.md). Expected values are worked out by hand in the comments.

const lease = (id: string, start: string, end: string | null, status = 'active') => ({ id, start_date: start, end_date: end, status, lease_tenants: [{ tenant_id: `t-${id}`, is_primary: true }] });

describe('lease segments (FIN-02, FIN-S3)', () => {
  it('splits a month at a move-out / move-in (end_date inclusive)', () => {
    const r = billing.segmentsFromLeases([lease('a', '2025-01-01', '2026-09-15', 'terminated'), lease('b', '2026-09-16', null)], '2026-09-01', '2026-10-01');
    expect(r.problem).toBeNull();
    expect(r.segments.map((s) => [s.leaseId, s.start, s.end])).toEqual([
      ['a', '2026-09-01', '2026-09-16'],
      ['b', '2026-09-16', '2026-10-01'],
    ]);
  });
  it('refuses a terminated lease without an end date instead of billing it to period end', () => {
    const r = billing.segmentsFromLeases([lease('a', '2025-01-01', null, 'terminated'), lease('b', '2026-09-15', null)], '2026-09-01', '2026-10-01');
    expect(r.segments).toEqual([]);
    expect(r.problem).toMatch(/no end date/);
  });
  it('refuses overlapping leases on one unit', () => {
    const r = billing.segmentsFromLeases([lease('a', '2025-01-01', '2026-09-20', 'expired'), lease('b', '2026-09-10', null)], '2026-09-01', '2026-10-01');
    expect(r.problem).toMatch(/overlap/);
  });
  it('ignores leases outside the window and clips to it', () => {
    const r = billing.segmentsFromLeases([lease('old', '2024-01-01', '2025-12-31', 'expired'), lease('a', '2026-01-01', null)], '2026-09-10', '2026-09-20');
    expect(r.segments.map((s) => [s.start, s.end])).toEqual([['2026-09-10', '2026-09-20']]);
  });
});

describe('arrangement window (FIN-01)', () => {
  it('a mid-period change closes the old arrangement the day before; windows do not overlap', () => {
    const oldA = billing.arrangementWindow({ effective_from: '2026-01-01', effective_to: '2026-10-15' }, '2026-10-01', '2026-11-01');
    const newA = billing.arrangementWindow({ effective_from: '2026-10-16', effective_to: null }, '2026-10-01', '2026-11-01');
    expect(oldA).toEqual({ from: '2026-10-01', to: '2026-10-16' });
    expect(newA).toEqual({ from: '2026-10-16', to: '2026-11-01' });
  });
  it('an arrangement outside the period has no window', () => {
    expect(billing.arrangementWindow({ effective_from: '2026-12-01', effective_to: null }, '2026-10-01', '2026-11-01')).toBeNull();
    expect(billing.arrangementWindow({ effective_from: '2026-01-01', effective_to: '2026-09-30' }, '2026-10-01', '2026-11-01')).toBeNull();
  });
});

describe('tariff split at a mid-period change (FIN-07)', () => {
  const t = (id: string, from: string, to: string | null, unit: string | null = null) =>
    ({ id, name: id, utility_type: 'water', tariff_kind: 'flat', fixed_charge: 0, blocks: [{ upTo: null, rate: 30 }], tou_periods: [], seasons: [], vat_inclusive: true, vat_rate: 15, prorate_blocks: true, unit_id: unit, supply_source_type: null, effective_from: from, effective_to: to, requires_review: false }) as TariffRow;
  it('15 Jun – 15 Jul with the 1 July increase becomes two pieces', () => {
    const r = billing.splitByTariff([t('2025/26', '2025-07-01', '2026-06-30'), t('2026/27', '2026-07-01', null)], 'water', null, { start: '2026-06-15', end: '2026-07-15' });
    expect(r.uncovered).toBeNull();
    expect(r.pieces.map((p) => [p.start, p.end, p.tariff.id])).toEqual([
      ['2026-06-15', '2026-07-01', '2025/26'],
      ['2026-07-01', '2026-07-15', '2026/27'],
    ]);
  });
  it('a unit-specific tariff wins; a gap in tariff cover is reported, never priced', () => {
    const r = billing.splitByTariff([t('prop', '2026-01-01', null), t('unit', '2026-01-01', null, 'u1')], 'water', 'u1', { start: '2026-09-01', end: '2026-10-01' });
    expect(r.pieces.map((p) => p.tariff.id)).toEqual(['unit']);
    expect(billing.splitByTariff([t('later', '2026-09-10', null)], 'water', null, { start: '2026-09-01', end: '2026-10-01' }).uncovered).toBe('2026-09-01');
  });
});

describe('VAT after a credit or adjustment (FIN-05)', () => {
  it('R115,00 incl (R100 + R15) credited R57,50 → R57,50 incl = R50,00 + R7,50', () => {
    expect(billing.rescaleVat(115, 100, 15, 57.5)).toEqual({ excl: 50, vat: 7.5 });
  });
  it('rounds half-up to the cent and keeps excl + VAT = total', () => {
    // R100,00 incl at 15 %: VAT 13,04; reduced to R33,33 → VAT 13,04 × 33,33/100 = 4,3462… → 4,35? no: 4,346 → 4,35
    const r = billing.rescaleVat(100, 86.96, 13.04, 33.33);
    expect(r.vat).toBe(4.35);
    expect(Math.round((r.excl! + r.vat!) * 100)).toBe(3333);
  });
  it('a charge without VAT figures stays without VAT figures; zero total is zero VAT', () => {
    expect(billing.rescaleVat(500, null, null, 400)).toEqual({ excl: null, vat: null });
    expect(billing.rescaleVat(115, 100, 15, 0)).toEqual({ excl: 0, vat: 0 });
  });
});

describe('SSRF guard resolves names (SEC-03)', () => {
  it('classifies private, loopback, link-local, CGNAT and IPv6 private addresses', () => {
    for (const a of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '172.20.1.1', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(providers.isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ['93.184.216.34', '41.185.8.1', '2001:4860:4860::8888']) expect(providers.isPrivateAddress(a), a).toBe(false);
  });
  it('refuses a public-looking hostname that resolves to a private address, and an unresolvable one', async () => {
    const url = new URL('https://tb.customer.example');
    await expect(providers.assertResolvesPublic(url, async () => ['10.1.2.3'])).rejects.toThrow(/private or reserved/);
    await expect(providers.assertResolvesPublic(url, async () => ['93.184.216.34', '169.254.169.254'])).rejects.toThrow(/private or reserved/);
    await expect(providers.assertResolvesPublic(url, async () => { throw new Error('ENOTFOUND'); })).rejects.toThrow(/could not be resolved/);
    await expect(providers.assertResolvesPublic(url, async () => ['93.184.216.34'])).resolves.toBeUndefined();
  });
  it('a poll never reaches fetch when the name resolves privately', async () => {
    const fetchImpl = vi.fn();
    await expect(
      providers.thingsboardPoll({ config: { baseUrl: 'https://rebind.example' }, credentials: { apiKey: 'k' }, fetchImpl: fetchImpl as never, lookupImpl: async () => ['127.0.0.1'] }, [{ deviceId: '0f1e2d3c-0000-4000-8000-000000000001', channel: 'energy' }], new Date(0), new Date()),
    ).rejects.toThrow(/private or reserved/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ThingsBoard paging (INT-01)', () => {
  const DEVICE = '0f1e2d3c-0000-4000-8000-000000000001';
  it('reads every page instead of stopping at 1 000 points', async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ ts: 1_000_000 + i * 1000, value: String(i) }));
    const fetchImpl = vi.fn(async (url: URL) => {
      const start = Number(url.searchParams.get('startTs'));
      const page = all.filter((p) => p.ts >= start).slice(0, 1000);
      return Response.json({ energy: page });
    });
    const out = await providers.thingsboardPoll({ config: { baseUrl: 'https://tb.example.com' }, credentials: { apiKey: 'k' }, fetchImpl: fetchImpl as never, lookupImpl: async () => ['93.184.216.34'] }, [{ deviceId: DEVICE, channel: 'energy' }], new Date(0), new Date(10_000_000_000));
    const unique = new Set(out.map((r) => r.readAt.getTime()));
    expect(unique.size).toBe(2500);
    expect(fetchImpl.mock.calls.length).toBe(3);
  });
});
