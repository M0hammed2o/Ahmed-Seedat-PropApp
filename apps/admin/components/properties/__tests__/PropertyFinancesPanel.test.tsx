// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { PropertyFinancesPanel } from '../PropertyFinancesPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Real bug found and fixed (WORKLOG.md this date, web financials V1 pass part 3): a genuine API
// failure (RLS denial, a missing table/migration on an environment behind on migrations, a real
// network error -- anything non-2xx) on ANY of the three parallel fetches this panel's load()
// makes turned into an uncaught `TypeError: Cannot read properties of undefined (reading 'find')`
// at render time, taking out the entire page via the root error boundary ("Something went wrong"),
// not just this panel. Root cause: `if (costsBody) setCosts(costsBody.recurringCosts)` checked
// truthiness of the whole response body (safeJson() never returns null/undefined, so this was
// always true) instead of the field itself, so a failure response (`{error: {...}}`) set `costs`
// to `undefined` rather than leaving it `[]`. Reproduced empirically via a real Playwright browser
// session with the recurring-costs endpoint intercepted to return 500 -- the exact same stack trace
// this test guards against. Fixed with a `?? []` fallback (matching the sibling
// UnitFinancesPanel.tsx, which already had it) plus a genuine error message on failure.
function stubFetchWithFailingRecurringCosts() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url.includes('/recurring-costs')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({
            error: { code: 'recurring_costs_failed', message: 'Simulated failure (e.g. missing table/migration)' },
          }),
        });
      }
      if (url.includes('/utility-settings')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ utilitySettings: [] }) });
      }
      // /budget?month=...
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          budgetVsActual: {
            budgetId: null,
            plannedAmount: null,
            actualAmount: 0,
            remainingAmount: null,
            varianceAmount: null,
            percentUsed: null,
          },
        }),
      });
    }),
  );
}

describe('PropertyFinancesPanel', () => {
  it('does not crash when the recurring-costs API call fails -- renders an error message instead of throwing', async () => {
    stubFetchWithFailingRecurringCosts();

    render(<PropertyFinancesPanel propertyId="property-1" orgId="org-1" canManage={true} />);

    await waitFor(() =>
      expect(
        screen.getByText(/Simulated failure \(e\.g\. missing table\/migration\)/),
      ).toBeTruthy(),
    );
    // The panel's own headings still render -- proof the component tree survived instead of being
    // replaced by the root error boundary. `getByRole('heading', ...)` (not getByText) because the
    // "nothing configured yet" guide panel added later also has a "Monthly budget" radio option.
    expect(screen.getByText('Property-level rates & levies (expected/configured)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Monthly budget' })).toBeTruthy();
  });

  it('renders normally (no error banner) when every call succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ recurringCosts: [], utilitySettings: [], budgetVsActual: null }),
      }),
    );

    render(<PropertyFinancesPanel propertyId="property-1" orgId="org-1" canManage={true} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Monthly budget' })).toBeTruthy());
    expect(screen.queryByText(/Simulated failure/)).toBeNull();
  });
});
