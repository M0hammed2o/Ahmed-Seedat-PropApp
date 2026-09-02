'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  RecurringPropertyCost,
  UtilityResponsibilitySetting,
  UtilityResponsibilityMode,
  BudgetVsActual,
} from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { safeJson } from '@/lib/safeJson';

// V1 utilities/rates/levies/budgets pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §5A,
// UTILITIES_RATES_BUDGET_IMPLEMENTATION.md). Property-level setup only -- unit-level rates/levy/
// responsibility setup is the corresponding panel on the unit detail page (§5B), not duplicated
// here. Rendered as the property detail page's "Finances" tab, alongside the existing
// LevyStatementsPanel (Management tab) rather than replacing it.

const RESPONSIBILITY_LABELS: Record<UtilityResponsibilityMode, string> = {
  owner_paid: 'Owner pays',
  tenant_paid_direct: 'Tenant pays directly',
  tenant_prepaid: 'Tenant prepaid (voucher/token)',
  included_in_rent: 'Included in rent',
  common_area_owner: 'Common area (owner)',
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export function PropertyFinancesPanel({
  propertyId,
  orgId,
  canManage,
}: {
  propertyId: string;
  orgId: string;
  canManage: boolean;
}) {
  const [costs, setCosts] = useState<RecurringPropertyCost[]>([]);
  const [settings, setSettings] = useState<UtilityResponsibilitySetting[]>([]);
  const [budgetVsActual, setBudgetVsActual] = useState<BudgetVsActual | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [waterMode, setWaterMode] = useState<UtilityResponsibilityMode>('owner_paid');
  const [electricityMode, setElectricityMode] = useState<UtilityResponsibilityMode>('owner_paid');
  const [budgetAmount, setBudgetAmount] = useState('');
  const month = currentMonth();

  const load = useCallback(async () => {
    setError(null);
    const [costsRes, settingsRes, budgetRes] = await Promise.all([
      fetch(`/api/v1/properties/${propertyId}/recurring-costs`),
      fetch(`/api/v1/properties/${propertyId}/utility-settings`),
      fetch(`/api/v1/properties/${propertyId}/budget?month=${month}`),
    ]);
    const costsBody = await safeJson(costsRes);
    const settingsBody = await safeJson(settingsRes);
    const budgetBody = await safeJson(budgetRes);
    if (costsBody) setCosts(costsBody.recurringCosts);
    if (settingsBody) setSettings(settingsBody.utilitySettings);
    if (budgetBody) setBudgetVsActual(budgetBody.budgetVsActual);
    setLoaded(true);
  }, [propertyId, month]);

  useEffect(() => {
    load();
  }, [load]);

  const currentRates = costs.find((c) => c.costType === 'rates_and_taxes' && !c.unitId && !c.effectiveTo);
  const currentLevy = costs.find((c) => c.costType === 'levy' && !c.unitId && !c.effectiveTo);
  const currentWater = settings.find((s) => s.utilityType === 'water' && !s.unitId);
  const currentElectricity = settings.find((s) => s.utilityType === 'electricity' && !s.unitId);

  async function setCost(costType: 'rates_and_taxes' | 'levy', amount: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/recurring-costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          costType,
          amount: amount.trim() === '' ? null : Number(amount),
          effectiveFrom: new Date().toISOString().slice(0, 10),
        }),
      });
      if (!response.ok) {
        const body = await safeJson(response);
        setError(body?.error?.message ?? 'Could not save this amount.');
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function setResponsibility(utilityType: 'water' | 'electricity', mode: UtilityResponsibilityMode) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/utility-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, utilityType, responsibilityMode: mode }),
      });
      if (!response.ok) {
        const body = await safeJson(response);
        setError(body?.error?.message ?? 'Could not save responsibility.');
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleBudgetSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/budget`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, month, plannedAmount: Number(budgetAmount) }),
      });
      if (!response.ok) {
        const body = await safeJson(response);
        setError(body?.error?.message ?? 'Could not save this budget.');
        return;
      }
      setBudgetAmount('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </div>
      ) : null}

      <Panel>
        <h3 className="mb-3 text-sm font-semibold">Property-level rates & levies</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          For a property owned as a whole building/complex. If this property is sectional-title
          (individually owned units), set rates & taxes and levies per unit instead, on each unit's
          own page.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <RecurringCostField
            label="Rates & taxes"
            current={currentRates}
            disabled={!canManage || busy}
            onSave={(amount) => setCost('rates_and_taxes', amount)}
          />
          <RecurringCostField
            label="Levy"
            current={currentLevy}
            disabled={!canManage || busy}
            onSave={(amount) => setCost('levy', amount)}
          />
        </div>
      </Panel>

      <Panel>
        <h3 className="mb-3 text-sm font-semibold">Utility responsibility</h3>
        <div className="grid grid-cols-2 gap-4">
          <ResponsibilityField
            label="Water"
            value={currentWater?.responsibilityMode ?? waterMode}
            disabled={!canManage || busy}
            onChange={(mode) => {
              setWaterMode(mode);
              setResponsibility('water', mode);
            }}
          />
          <ResponsibilityField
            label="Electricity"
            value={currentElectricity?.responsibilityMode ?? electricityMode}
            disabled={!canManage || busy}
            onChange={(mode) => {
              setElectricityMode(mode);
              setResponsibility('electricity', mode);
            }}
          />
        </div>
      </Panel>

      <Panel>
        <h3 className="mb-3 text-sm font-semibold">Monthly budget</h3>
        {budgetVsActual?.plannedAmount !== null && budgetVsActual?.plannedAmount !== undefined ? (
          <div className="mb-3 grid grid-cols-4 gap-3 text-xs">
            <Metric label="Planned" value={`R ${budgetVsActual.plannedAmount.toLocaleString()}`} />
            <Metric label="Actual" value={`R ${budgetVsActual.actualAmount.toLocaleString()}`} />
            <Metric
              label="Remaining"
              value={`R ${(budgetVsActual.remainingAmount ?? 0).toLocaleString()}`}
            />
            <Metric label="% used" value={`${budgetVsActual.percentUsed ?? 0}%`} />
          </div>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">No budget set for this month yet.</p>
        )}
        {canManage ? (
          <form onSubmit={handleBudgetSubmit} className="flex items-end gap-2">
            <label className="block text-xs">
              <span className="text-muted-foreground">This month&apos;s planned amount (R)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(e.target.value)}
                className="mt-1 block w-40 rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
              />
            </label>
            <Button type="submit" variant="primary" disabled={busy}>
              Save
            </Button>
          </form>
        ) : null}
      </Panel>

      <AnnualBudgetPanel propertyId={propertyId} orgId={orgId} canManage={canManage} />
    </div>
  );
}

function currentYear(): number {
  return new Date().getFullYear();
}

/** §13 annual budget planning -- "enter annual amount, distribute evenly across 12 months, allow
 * month-by-month editing after distribution". The 12 monthly property_budgets rows remain the only
 * source of truth (migration 164's own design) -- this panel is purely a convenience UI over
 * set_monthly_budget()/distribute_annual_budget(), never a second stored total. */
function AnnualBudgetPanel({
  propertyId,
  orgId,
  canManage,
}: {
  propertyId: string;
  orgId: string;
  canManage: boolean;
}) {
  const [year, setYear] = useState(currentYear());
  const [months, setMonths] = useState<{ month: string; planned: number | null }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [annualTotal, setAnnualTotal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState('');

  const load = useCallback(async () => {
    setLoaded(false);
    const monthKeys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);
    const results = await Promise.all(
      monthKeys.map((m) =>
        fetch(`/api/v1/properties/${propertyId}/budget?month=${m}`).then((r) => safeJson(r)),
      ),
    );
    setMonths(
      monthKeys.map((m, i) => ({
        month: m,
        planned: results[i]?.budgetVsActual?.plannedAmount ?? null,
      })),
    );
    setLoaded(true);
  }, [propertyId, year]);

  useEffect(() => {
    load();
  }, [load]);

  const annualPlannedSum = months.reduce((sum, m) => sum + (m.planned ?? 0), 0);
  const monthsSet = months.filter((m) => m.planned !== null).length;

  async function handleDistribute(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/budget/annual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, year, annualTotal: Number(annualTotal) }),
      });
      if (!response.ok) {
        const body = await safeJson(response);
        setError(body?.error?.message ?? 'Could not distribute the annual budget.');
        return;
      }
      setAnnualTotal('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveMonth(month: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/budget`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, month, plannedAmount: Number(editingAmount) }),
      });
      if (!response.ok) {
        const body = await safeJson(response);
        setError(body?.error?.message ?? 'Could not save this month.');
        return;
      }
      setEditingMonth(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Annual budget</h3>
        <div className="flex items-center gap-2 text-xs">
          <button type="button" onClick={() => setYear((y) => y - 1)} className="px-1">
            ←
          </button>
          <span>{year}</span>
          <button type="button" onClick={() => setYear((y) => y + 1)} className="px-1">
            →
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </div>
      ) : null}

      {!loaded ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 text-xs">
            <Metric label="Months with a budget set" value={`${monthsSet} / 12`} />
            <Metric label={`${year} planned total`} value={`R ${annualPlannedSum.toLocaleString()}`} />
          </div>

          <div className="mb-4 grid grid-cols-3 gap-2 text-xs sm:grid-cols-4">
            {months.map((m) => {
              const label = new Date(`${m.month}T00:00:00Z`).toLocaleDateString('en-ZA', { month: 'short' });
              const isEditing = editingMonth === m.month;
              return (
                <div key={m.month} className="rounded-md border border-light-border p-2 dark:border-dark-border">
                  <p className="text-muted-foreground">{label}</p>
                  {isEditing ? (
                    <div className="mt-1 flex gap-1">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        autoFocus
                        value={editingAmount}
                        onChange={(e) => setEditingAmount(e.target.value)}
                        className="w-16 rounded border border-light-border bg-transparent px-1 py-0.5 dark:border-dark-border"
                      />
                      <button type="button" onClick={() => saveMonth(m.month)} disabled={busy} className="text-light-accent dark:text-dark-accent">
                        ✓
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!canManage}
                      onClick={() => {
                        setEditingMonth(m.month);
                        setEditingAmount(m.planned !== null ? String(m.planned) : '');
                      }}
                      className="mt-1 block font-medium"
                    >
                      {m.planned !== null ? `R ${m.planned.toLocaleString()}` : '—'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {canManage ? (
            <form onSubmit={handleDistribute} className="flex items-end gap-2">
              <label className="block text-xs">
                <span className="text-muted-foreground">Distribute an annual total evenly across {year}&apos;s 12 months (R)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={annualTotal}
                  onChange={(e) => setAnnualTotal(e.target.value)}
                  className="mt-1 block w-48 rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
                />
              </label>
              <Button type="submit" variant="primary" disabled={busy}>
                Distribute
              </Button>
            </form>
          ) : null}
        </>
      )}
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function RecurringCostField({
  label,
  current,
  disabled,
  onSave,
}: {
  label: string;
  current: RecurringPropertyCost | undefined;
  disabled: boolean;
  onSave: (amount: string) => void;
}) {
  const [value, setValue] = useState(current ? String(current.amount) : '');
  useEffect(() => {
    setValue(current ? String(current.amount) : '');
  }, [current]);

  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label} (R/month, blank = not applicable)</span>
      <div className="mt-1 flex gap-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          className="block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
        />
        <Button type="button" disabled={disabled} onClick={() => onSave(value)}>
          Save
        </Button>
      </div>
    </label>
  );
}

function ResponsibilityField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: UtilityResponsibilityMode;
  disabled: boolean;
  onChange: (mode: UtilityResponsibilityMode) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as UtilityResponsibilityMode)}
        className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
      >
        {(Object.keys(RESPONSIBILITY_LABELS) as UtilityResponsibilityMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {RESPONSIBILITY_LABELS[mode]}
            </option>
          ))}
      </select>
    </label>
  );
}
