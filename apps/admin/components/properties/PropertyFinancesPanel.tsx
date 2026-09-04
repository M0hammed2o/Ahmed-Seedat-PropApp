'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  RecurringPropertyCost,
  UtilityResponsibilitySetting,
  UtilityResponsibilityMode,
  BudgetVsActual,
} from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Meter } from '@/components/ui/Meter';
import { Panel } from '@/components/ui/Panel';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { safeJson } from '@/lib/safeJson';

function budgetStatus(percentUsed: number | null): { label: string; tone: PillTone } {
  if (percentUsed === null) return { label: 'Not configured', tone: 'neutral' };
  if (percentUsed >= 100) return { label: 'Over budget', tone: 'destructive' };
  if (percentUsed >= 80) return { label: 'Approaching budget', tone: 'warning' };
  return { label: 'On track', tone: 'success' };
}

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

// Demo mode fixture (§13, web owner financial dashboard pass, this date): ADMIN_DEMO_MODE's
// property detail page reuses this exact client component rather than a separate demo view, but
// 'demo-property-1' is not a real row in any backing Supabase project -- without this, the panel's
// own fetch()es would 404/error against whatever project is actually configured. `demoMode` skips
// the network call entirely and renders realistic static figures instead, same rule DEMO_DATA on
// the main dashboard already follows.
const DEMO_TIMESTAMPS = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
// Property-level rates, no levy (WORKLOG.md this date, property/unit financial setup pass) --
// a whole-building owner scenario, matching the "Property A" demo scenario requirement: rates &
// taxes at the property level, no levy at all (never forced on an owner who isn't sectional-title).
const DEMO_COSTS: RecurringPropertyCost[] = [
  {
    id: 'demo-cost-rates',
    orgId: 'demo-org-1',
    propertyId: 'demo-property-1',
    unitId: null,
    costType: 'rates_and_taxes',
    amount: 1450,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    notes: null,
    ...DEMO_TIMESTAMPS,
  },
];
const DEMO_SETTINGS: UtilityResponsibilitySetting[] = [
  {
    id: 'demo-setting-water',
    orgId: 'demo-org-1',
    propertyId: 'demo-property-1',
    unitId: null,
    utilityType: 'water',
    responsibilityMode: 'owner_paid',
    active: true,
    notes: null,
    ...DEMO_TIMESTAMPS,
  },
  {
    id: 'demo-setting-electricity',
    orgId: 'demo-org-1',
    propertyId: 'demo-property-1',
    unitId: null,
    utilityType: 'electricity',
    responsibilityMode: 'tenant_prepaid',
    active: true,
    notes: null,
    ...DEMO_TIMESTAMPS,
  },
];
const DEMO_BUDGET: BudgetVsActual = {
  budgetId: 'demo-budget-1',
  plannedAmount: 5000,
  actualAmount: 4200,
  remainingAmount: 800,
  varianceAmount: -800,
  percentUsed: 84,
};

export function PropertyFinancesPanel({
  propertyId,
  orgId,
  canManage,
  demoMode,
}: {
  propertyId: string;
  orgId: string;
  canManage: boolean;
  demoMode?: boolean;
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
  const manageable = canManage && !demoMode;

  const load = useCallback(async () => {
    if (demoMode) {
      setCosts(DEMO_COSTS);
      setSettings(DEMO_SETTINGS);
      setBudgetVsActual(DEMO_BUDGET);
      setLoaded(true);
      return;
    }
    setError(null);
    const [costsRes, settingsRes, budgetRes] = await Promise.all([
      fetch(`/api/v1/properties/${propertyId}/recurring-costs`),
      fetch(`/api/v1/properties/${propertyId}/utility-settings`),
      fetch(`/api/v1/properties/${propertyId}/budget?month=${month}`),
    ]);
    const costsBody = await safeJson(costsRes);
    const settingsBody = await safeJson(settingsRes);
    const budgetBody = await safeJson(budgetRes);
    // Real bug found and fixed (WORKLOG.md this date): `if (costsBody) setCosts(costsBody.recurringCosts)`
    // checked truthiness of the RESPONSE BODY, not the field -- safeJson() never returns null/
    // undefined, so this was always true, including on a genuine failure (e.g. costsRes.ok false),
    // where costsBody is `{error: {...}}` and `.recurringCosts` is undefined. That set `costs` to
    // undefined instead of leaving it `[]`, and the very next line's `costs.find(...)` threw --
    // caught by the root error boundary as "Something went wrong," taking out the whole page, not
    // just this panel. `UnitFinancesPanel.tsx`'s equivalent load() already had the `?? []` guard;
    // this one didn't. Also now surfaces a real error message on any actual failure, instead of
    // silently rendering an empty-looking panel.
    if (!costsRes.ok || !settingsRes.ok || !budgetRes.ok) {
      setError(
        costsBody?.error?.message ??
          settingsBody?.error?.message ??
          budgetBody?.error?.message ??
          'Could not load this property’s financial setup. Try again.',
      );
    }
    setCosts(costsBody?.recurringCosts ?? []);
    setSettings(settingsBody?.utilitySettings ?? []);
    setBudgetVsActual(budgetBody?.budgetVsActual ?? null);
    setLoaded(true);
  }, [propertyId, month, demoMode]);

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

  const [guideDismissed, setGuideDismissed] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setGuideDismissed(window.localStorage.getItem(`financeGuideDismissed:${propertyId}`) === '1');
  }, [propertyId]);
  function dismissGuide() {
    setGuideDismissed(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`financeGuideDismissed:${propertyId}`, '1');
    }
  }

  if (!loaded) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </Panel>
    );
  }

  // Web property financial setup pass (WORKLOG.md this date): these questions used to only exist
  // as raw, unlabeled form fields an owner had to already know to come looking for -- "naturally
  // incorporated into setup" per the task's own framing. Shown once, the first time a property has
  // genuinely nothing configured (no recurring costs, no utility settings, no budget) -- reuses
  // every existing API this same panel's own fields already call, never a second backend. Once
  // anything is saved (through the guide or dismissed in favour of the fields below), it never
  // shows again for this property (localStorage, per-viewer -- not a new DB column for a one-time
  // UI nudge).
  const nothingConfiguredYet =
    costs.length === 0 &&
    settings.length === 0 &&
    (budgetVsActual?.plannedAmount === null || budgetVsActual?.plannedAmount === undefined);
  const showGuide = manageable && nothingConfiguredYet && !guideDismissed;

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </div>
      ) : null}

      {showGuide ? (
        <FinancialSetupGuide
          propertyId={propertyId}
          orgId={orgId}
          onDone={async () => {
            await load();
          }}
          onSkip={dismissGuide}
        />
      ) : null}

      <Panel>
        <h3 className="mb-3 text-sm font-semibold">Property-level rates & levies (expected/configured)</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          For a property owned as a whole building/complex. If this property is sectional-title
          (individually owned units), set rates & taxes and levies per unit instead, on each unit's
          own page. These are the recurring amounts you expect to pay each month -- not the same as
          the actual rates/levies expenses recorded above, which come only from posted expenses.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <RecurringCostField
            label="Expected monthly rates & taxes"
            current={currentRates}
            disabled={!manageable || busy}
            onSave={(amount) => setCost('rates_and_taxes', amount)}
          />
          <RecurringCostField
            label="Expected monthly levy"
            current={currentLevy}
            disabled={!manageable || busy}
            onSave={(amount) => setCost('levy', amount)}
          />
        </div>
      </Panel>

      <Panel>
        <h3 className="mb-3 text-sm font-semibold">Utility responsibility (property level)</h3>
        <div className="grid grid-cols-2 gap-4">
          <ResponsibilityField
            label="Water"
            value={currentWater?.responsibilityMode ?? waterMode}
            disabled={!manageable || busy}
            onChange={(mode) => {
              setWaterMode(mode);
              setResponsibility('water', mode);
            }}
          />
          <ResponsibilityField
            label="Electricity"
            value={currentElectricity?.responsibilityMode ?? electricityMode}
            disabled={!manageable || busy}
            onChange={(mode) => {
              setElectricityMode(mode);
              setResponsibility('electricity', mode);
            }}
          />
        </div>
      </Panel>

      <Panel id="property-budget">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Monthly budget</h3>
          {budgetVsActual?.plannedAmount !== null && budgetVsActual?.plannedAmount !== undefined ? (
            <Pill tone={budgetStatus(budgetVsActual.percentUsed ?? null).tone}>
              {budgetStatus(budgetVsActual.percentUsed ?? null).label}
            </Pill>
          ) : null}
        </div>
        {budgetVsActual?.plannedAmount !== null && budgetVsActual?.plannedAmount !== undefined ? (
          <>
            <div className="mb-3 grid grid-cols-4 gap-3 text-xs">
              <Metric label="Planned" value={`R ${budgetVsActual.plannedAmount.toLocaleString()}`} />
              <Metric label="Actual" value={`R ${budgetVsActual.actualAmount.toLocaleString()}`} />
              <Metric
                label="Remaining"
                value={`R ${(budgetVsActual.remainingAmount ?? 0).toLocaleString()}`}
              />
              <Metric label="% used" value={`${budgetVsActual.percentUsed ?? 0}%`} />
            </div>
            <div className="mb-3">
              <Meter
                value={budgetVsActual.percentUsed ?? 0}
                tone={
                  (budgetVsActual.percentUsed ?? 0) >= 100
                    ? 'destructive'
                    : (budgetVsActual.percentUsed ?? 0) >= 80
                      ? 'warning'
                      : 'success'
                }
              />
            </div>
          </>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">Budget not configured for this month yet.</p>
        )}
        {manageable ? (
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

      <AnnualBudgetPanel propertyId={propertyId} orgId={orgId} canManage={manageable} demoMode={demoMode} />
    </div>
  );
}

type RatesLevel = 'property' | 'unit';

/** Web property financial setup pass (WORKLOG.md this date): the guided "ask these questions
 *  during setup" flow -- rates/taxes level+amount, levies applicable+level+amount, water/
 *  electricity responsibility, budget monthly/annual/skip. Every save goes through the exact same
 *  API routes the plain fields below already use (POST recurring-costs/utility-settings/budget/
 *  budget/annual) -- this is a friendlier front door onto existing endpoints, not a new backend.
 *  Meter creation is deliberately NOT part of this guide -- the "Utility meters" panel is already
 *  the one place a meter gets created; duplicating that here would be a second data-entry path for
 *  the same thing. Property-level rates/levies are the only recurring-cost amounts collected here
 *  -- unit-level ones are collected per-unit, on that unit's own page/form, once the owner picks
 *  "unit-level" here (§4 of the task: "do not require one property-wide amount" for a unit-level
 *  cost). */
function FinancialSetupGuide({
  propertyId,
  orgId,
  onDone,
  onSkip,
}: {
  propertyId: string;
  orgId: string;
  onDone: () => Promise<void>;
  onSkip: () => void;
}) {
  const [ratesLevel, setRatesLevel] = useState<RatesLevel>('property');
  const [ratesAmount, setRatesAmount] = useState('');
  const [leviesApplicable, setLeviesApplicable] = useState<'yes' | 'no' | ''>('');
  const [leviesLevel, setLeviesLevel] = useState<RatesLevel>('property');
  const [leviesAmount, setLeviesAmount] = useState('');
  const [waterResponsibility, setWaterResponsibility] = useState<UtilityResponsibilityMode | ''>('');
  const [electricityResponsibility, setElectricityResponsibility] = useState<UtilityResponsibilityMode | ''>('');
  const [budgetChoice, setBudgetChoice] = useState<'monthly' | 'annual' | 'skip' | ''>('');
  const [budgetMonthlyAmount, setBudgetMonthlyAmount] = useState('');
  const [budgetAnnualAmount, setBudgetAnnualAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [guideError, setGuideError] = useState<string | null>(null);
  const month = currentMonth();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setGuideError(null);
    try {
      if (ratesLevel === 'property' && ratesAmount.trim() !== '') {
        const res = await fetch(`/api/v1/properties/${propertyId}/recurring-costs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            costType: 'rates_and_taxes',
            amount: Number(ratesAmount),
            effectiveFrom: new Date().toISOString().slice(0, 10),
          }),
        });
        if (!res.ok) {
          const body = await safeJson(res);
          throw new Error(body?.error?.message ?? 'Could not save rates & taxes.');
        }
      }

      if (leviesApplicable === 'yes' && leviesLevel === 'property' && leviesAmount.trim() !== '') {
        const res = await fetch(`/api/v1/properties/${propertyId}/recurring-costs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            costType: 'levy',
            amount: Number(leviesAmount),
            effectiveFrom: new Date().toISOString().slice(0, 10),
          }),
        });
        if (!res.ok) {
          const body = await safeJson(res);
          throw new Error(body?.error?.message ?? 'Could not save the levy.');
        }
      }

      for (const [utilityType, mode] of [
        ['water', waterResponsibility],
        ['electricity', electricityResponsibility],
      ] as const) {
        if (!mode) continue;
        const res = await fetch(`/api/v1/properties/${propertyId}/utility-settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, utilityType, responsibilityMode: mode }),
        });
        if (!res.ok) {
          const body = await safeJson(res);
          throw new Error(body?.error?.message ?? `Could not save ${utilityType} responsibility.`);
        }
      }

      if (budgetChoice === 'monthly' && budgetMonthlyAmount.trim() !== '') {
        const res = await fetch(`/api/v1/properties/${propertyId}/budget`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, month, plannedAmount: Number(budgetMonthlyAmount) }),
        });
        if (!res.ok) {
          const body = await safeJson(res);
          throw new Error(body?.error?.message ?? 'Could not save the monthly budget.');
        }
      } else if (budgetChoice === 'annual' && budgetAnnualAmount.trim() !== '') {
        const res = await fetch(`/api/v1/properties/${propertyId}/budget/annual`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, year: currentYear(), annualTotal: Number(budgetAnnualAmount) }),
        });
        if (!res.ok) {
          const body = await safeJson(res);
          throw new Error(body?.error?.message ?? 'Could not distribute the annual budget.');
        }
      }

      await onDone();
    } catch (err) {
      setGuideError(err instanceof Error ? err.message : 'Could not save financial setup.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel
      title="Set up financial details"
      description="A few quick questions -- every answer stays editable afterwards, and you can skip this and configure things manually below at any time."
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {guideError ? (
          <div className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {guideError}
          </div>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold">Rates &amp; taxes</legend>
          <div className="flex gap-4 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="rates-level"
                checked={ratesLevel === 'property'}
                onChange={() => setRatesLevel('property')}
              />
              Property-level
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="rates-level"
                checked={ratesLevel === 'unit'}
                onChange={() => setRatesLevel('unit')}
              />
              Unit-level (sectional title)
            </label>
          </div>
          {ratesLevel === 'property' ? (
            <label className="block text-xs">
              <span className="text-muted-foreground">Expected monthly rates &amp; taxes (R, blank = not applicable)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={ratesAmount}
                onChange={(e) => setRatesAmount(e.target.value)}
                className="mt-1 block w-48 rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
              />
            </label>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              You&apos;ll set the amount when you add or edit each unit.
            </p>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold">Levies</legend>
          <p className="text-[11px] text-muted-foreground">
            Does this property have levies? A whole-building owner often has none.
          </p>
          <div className="flex gap-4 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="levies-applicable"
                checked={leviesApplicable === 'yes'}
                onChange={() => setLeviesApplicable('yes')}
              />
              Yes
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="levies-applicable"
                checked={leviesApplicable === 'no'}
                onChange={() => setLeviesApplicable('no')}
              />
              No
            </label>
          </div>
          {leviesApplicable === 'yes' ? (
            <>
              <div className="flex gap-4 text-xs">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="levies-level"
                    checked={leviesLevel === 'property'}
                    onChange={() => setLeviesLevel('property')}
                  />
                  Property-level
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="levies-level"
                    checked={leviesLevel === 'unit'}
                    onChange={() => setLeviesLevel('unit')}
                  />
                  Unit-level (sectional title)
                </label>
              </div>
              {leviesLevel === 'property' ? (
                <label className="block text-xs">
                  <span className="text-muted-foreground">Expected monthly levy (R)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={leviesAmount}
                    onChange={(e) => setLeviesAmount(e.target.value)}
                    className="mt-1 block w-48 rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
                  />
                </label>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  You&apos;ll set the amount when you add or edit each unit.
                </p>
              )}
            </>
          ) : null}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold">Utility responsibility</legend>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-xs">
              <span className="text-muted-foreground">Water</span>
              <select
                value={waterResponsibility}
                onChange={(e) => setWaterResponsibility(e.target.value as UtilityResponsibilityMode | '')}
                className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
              >
                <option value="">Not applicable / skip for now</option>
                {(Object.keys(RESPONSIBILITY_LABELS) as UtilityResponsibilityMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {RESPONSIBILITY_LABELS[mode]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">Electricity</span>
              <select
                value={electricityResponsibility}
                onChange={(e) => setElectricityResponsibility(e.target.value as UtilityResponsibilityMode | '')}
                className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
              >
                <option value="">Not applicable / skip for now</option>
                {(Object.keys(RESPONSIBILITY_LABELS) as UtilityResponsibilityMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {RESPONSIBILITY_LABELS[mode]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {waterResponsibility === 'tenant_prepaid' || electricityResponsibility === 'tenant_prepaid' ? (
            <p className="text-[11px] text-muted-foreground">
              Tenant prepaid means the tenant buys their own prepaid water/electricity vouchers --
              you don&apos;t need to record those purchases as portfolio expenses.
            </p>
          ) : null}
          {waterResponsibility === 'owner_paid' || electricityResponsibility === 'owner_paid' ? (
            <p className="text-[11px] text-muted-foreground">
              If there&apos;s a real meter to track, add it in the Utility meters section below once
              you&apos;re done here.
            </p>
          ) : null}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold">Budget</legend>
          <p className="text-[11px] text-muted-foreground">Would you like to set a property budget?</p>
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="budget-choice"
                checked={budgetChoice === 'monthly'}
                onChange={() => setBudgetChoice('monthly')}
              />
              Monthly budget
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="budget-choice"
                checked={budgetChoice === 'annual'}
                onChange={() => setBudgetChoice('annual')}
              />
              Annual budget
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="budget-choice"
                checked={budgetChoice === 'skip'}
                onChange={() => setBudgetChoice('skip')}
              />
              Skip for now
            </label>
          </div>
          {budgetChoice === 'monthly' ? (
            <label className="block text-xs">
              <span className="text-muted-foreground">Planned operating spend this month (R)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={budgetMonthlyAmount}
                onChange={(e) => setBudgetMonthlyAmount(e.target.value)}
                className="mt-1 block w-48 rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
              />
            </label>
          ) : null}
          {budgetChoice === 'annual' ? (
            <label className="block text-xs">
              <span className="text-muted-foreground">Annual planned operating spend (R) -- distributed evenly across 12 months, editable after</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={budgetAnnualAmount}
                onChange={(e) => setBudgetAnnualAmount(e.target.value)}
                className="mt-1 block w-48 rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
              />
            </label>
          ) : null}
        </fieldset>

        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save financial setup'}
          </Button>
          <Button type="button" onClick={onSkip} disabled={submitting}>
            Skip -- I&apos;ll configure this later
          </Button>
        </div>
      </form>
    </Panel>
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
  demoMode,
}: {
  propertyId: string;
  orgId: string;
  canManage: boolean;
  demoMode?: boolean;
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
    if (demoMode) {
      // A realistic partial year -- most months set, the current one still open, matching what an
      // owner who has only just started budgeting would actually see.
      setMonths(monthKeys.map((m, i) => ({ month: m, planned: i < 8 ? 5000 : null })));
      setLoaded(true);
      return;
    }
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
  }, [propertyId, year, demoMode]);

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
