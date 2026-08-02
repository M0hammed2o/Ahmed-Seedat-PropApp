// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { TaxPackClient } from '../TaxPackClient';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TaxPackClient', () => {
  it('fetches the tax pack for the default year and renders totals, lines, and the disclaimer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          taxYear: 2027,
          lines: [
            {
              propertyId: 'property-1',
              propertyName: 'Sunset Villas',
              accountType: 'income',
              accountCode: '4000',
              accountName: 'Rent Income',
              amount: 12000,
            },
          ],
          totalIncome: 12000,
          totalExpenses: 0,
          netIncome: 12000,
          disclaimer: 'This tax pack is not tax advice.',
        }),
      }),
    );

    render(<TaxPackClient orgId="org-1" />);

    await waitFor(() => expect(screen.getByText('Sunset Villas')).toBeTruthy());
    expect(screen.getByText('Rent Income')).toBeTruthy();
    expect(screen.getByText('This tax pack is not tax advice.')).toBeTruthy();
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('org_id=org-1');
  });

  it('shows an empty-state row when there is no activity for the selected year', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          taxYear: 2027,
          lines: [],
          totalIncome: 0,
          totalExpenses: 0,
          netIncome: 0,
          disclaimer: 'This tax pack is not tax advice.',
        }),
      }),
    );

    render(<TaxPackClient orgId="org-1" />);

    await waitFor(() => expect(screen.getByText('No income or expense activity for this tax year.')).toBeTruthy());
  });
});
