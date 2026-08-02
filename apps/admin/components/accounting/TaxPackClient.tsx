'use client';

import { useEffect, useState } from 'react';
import type { TaxPackLine } from '@propvault/types';

function currentSaTaxYear(): number {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  return month >= 3 ? now.getFullYear() + 1 : now.getFullYear();
}

interface TaxPackResponse {
  taxYear: number;
  lines: TaxPackLine[];
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  disclaimer: string;
}

// ACCOUNTING.md §7 -- SA tax year runs 1 March - end of February; "tax_year" labels the year it
// ENDS in (e.g. 2027 = 1 Mar 2026 - 28/29 Feb 2027), matching compute_tax_pack()'s own convention.
export function TaxPackClient({ orgId }: { orgId: string }) {
  const [taxYear, setTaxYear] = useState(currentSaTaxYear());
  const [data, setData] = useState<TaxPackResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/v1/tax-pack?org_id=${orgId}&tax_year=${taxYear}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? 'Failed to load tax pack.');
        if (!cancelled) setData(body);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, taxYear]);

  const yearOptions = Array.from({ length: 6 }, (_, i) => currentSaTaxYear() - i);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Tax year (ending Feb)
          <select
            value={taxYear}
            onChange={(e) => setTaxYear(Number(e.target.value))}
            className="ml-2 rounded-md border border-light-border bg-transparent px-2 py-1 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y - 1} – {y}
              </option>
            ))}
          </select>
        </label>
        <a
          href={`/api/v1/tax-pack/export?org_id=${orgId}&tax_year=${taxYear}`}
          className="rounded-md bg-light-accent px-3 py-1.5 text-sm font-medium text-light-accentContrast dark:bg-dark-accent dark:text-dark-accentContrast"
        >
          Download CSV
        </a>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-light-statusOverdue dark:text-dark-statusOverdue">{error}</p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-light-textSecondary dark:text-dark-textSecondary">Loading…</p>
      ) : null}

      {!loading && data ? (
        <>
          <div className="mt-6 grid grid-cols-3 gap-4 text-sm">
            <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
              <p className="text-light-textSecondary dark:text-dark-textSecondary">Total income</p>
              <p className="mt-1 text-lg font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                R{data.totalIncome.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
              <p className="text-light-textSecondary dark:text-dark-textSecondary">Total expenses</p>
              <p className="mt-1 text-lg font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                R{data.totalExpenses.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
              <p className="text-light-textSecondary dark:text-dark-textSecondary">Net</p>
              <p className="mt-1 text-lg font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                R{data.netIncome.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          <table className="mt-6 w-full text-sm">
            <thead>
              <tr className="border-b border-light-border text-left text-light-textSecondary dark:border-dark-border dark:text-dark-textSecondary">
                <th className="py-2 font-medium">Property</th>
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 font-medium">Account</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-light-textMuted dark:text-dark-textMuted">
                    No income or expense activity for this tax year.
                  </td>
                </tr>
              ) : (
                data.lines.map((line, i) => (
                  <tr key={i} className="border-b border-light-border dark:border-dark-border">
                    <td className="py-2 text-light-textPrimary dark:text-dark-textPrimary">
                      {line.propertyName ?? 'Unattributed'}
                    </td>
                    <td className="py-2 capitalize text-light-textSecondary dark:text-dark-textSecondary">
                      {line.accountType}
                    </td>
                    <td className="py-2 text-light-textPrimary dark:text-dark-textPrimary">{line.accountName}</td>
                    <td className="py-2 text-right font-medium text-light-textPrimary dark:text-dark-textPrimary">
                      R{line.amount.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <p className="mt-6 text-xs text-light-textMuted dark:text-dark-textMuted">{data.disclaimer}</p>
        </>
      ) : null}
    </div>
  );
}
