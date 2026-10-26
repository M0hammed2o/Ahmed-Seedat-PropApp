import { describe, expect, it } from 'vitest';
import { computeCemeteryMetrics, withBalances, type PaymentRow, type SaleRow } from '@/lib/cemetery/data';
import { formatZar, tenureTerms } from '@/lib/cemetery/terms';

const sale = (id: string, price: number, extra: Partial<SaleRow> = {}): SaleRow => ({
  id,
  org_id: 'o',
  cemetery_id: 'c',
  site_id: `site-${id}`,
  purchaser_id: 'p',
  sale_number: `GS-${id}`,
  tenure_model: 'burial_rights',
  sale_date: '2026-10-02',
  price,
  status: 'active',
  is_demo: false,
  notes: null,
  created_at: '2026-10-02T00:00:00Z',
  ...extra,
});
const pay = (saleId: string, amount: number, paidOn = '2026-10-05'): PaymentRow => ({
  id: `${saleId}-${amount}`,
  org_id: 'o',
  sale_id: saleId,
  receipt_number: 'GR-1',
  amount,
  paid_on: paidOn,
  method: 'eft',
  reference: null,
  is_deposit: false,
  is_demo: false,
  notes: null,
  created_at: '2026-10-05T00:00:00Z',
});

describe('cemetery balances and metrics', () => {
  it('outstanding = price - payments, per sale; cancelled sales owe nothing', () => {
    const rows = withBalances(
      [sale('1', 12000), sale('2', 9000), sale('3', 5000, { status: 'cancelled' })],
      [pay('1', 3000), pay('1', 4000.5), pay('2', 9000)],
    );
    expect(rows.map((r) => [r.paid, r.balance])).toEqual([
      [7000.5, 4999.5],
      [9000, 0],
      [0, 0],
    ]);
  });

  it('keeps sale status and burial status separate and never mixes in rental figures', () => {
    const sites = [
      { sale_status: 'available', burial_status: 'unused' },
      { sale_status: 'reserved', burial_status: 'unused' },
      { sale_status: 'sold', burial_status: 'unused' },
      { sale_status: 'sold', burial_status: 'occupied' },
      { sale_status: 'unavailable', burial_status: 'unused' },
    ] as const;
    const sales = withBalances([sale('1', 10000), sale('2', 8000, { sale_date: '2025-01-01' })], [pay('1', 2500), pay('2', 8000, '2025-02-01')]);
    const m = computeCemeteryMetrics([...sites], sales, [pay('1', 2500), pay('2', 8000, '2025-02-01')], new Date('2026-10-26T10:00:00Z'));
    expect(m).toMatchObject({
      totalSites: 5,
      available: 1,
      reserved: 1,
      sold: 2,
      unavailable: 1,
      occupied: 1,
      salesValue: 18000,
      paymentsReceived: 10500,
      outstanding: 7500,
      paymentsThisMonth: 2500,
      salesThisMonth: 1,
      salesWithBalance: 1,
    });
  });

  it('uses burial-rights wording by default and land-sale wording when configured', () => {
    expect(tenureTerms('burial_rights')).toMatchObject({ holder: 'Rights holder', sold: 'Rights granted', recordTitle: 'Grant of Right of Interment' });
    expect(tenureTerms('land_sale')).toMatchObject({ holder: 'Purchaser', sold: 'Sold', recordTitle: 'Grave Plot Sale Agreement' });
  });

  it('formats rand amounts', () => {
    expect(formatZar(12500).replace(/\s/g, ' ')).toBe('R 12 500');
    expect(formatZar(12500.5, { cents: true }).replace(/\s/g, ' ')).toBe('R 12 500,50');
  });
});
