'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  RecurringPropertyCost,
  UtilityResponsibilitySetting,
  UtilityResponsibilityMode,
} from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { safeJson } from '@/lib/safeJson';

// Continuation pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §5B/§11, UTILITIES_RATES_BUDGET_IMPLEMENTATION.md).
// Unit-level rates & taxes / levy / utility responsibility -- the previous pass explicitly deferred
// this (only the property-level PropertyFinancesPanel shipped). Reuses the exact same
// recurring-costs/utility-settings API the property panel uses, always passing this unit's id --
// no new backend surface, per the task's own "do not duplicate backend logic" rule. No budget
// section here -- property_budgets is property-scoped only (DATABASE.md), never per-unit.

const RESPONSIBILITY_LABELS: Record<UtilityResponsibilityMode, string> = {
  owner_paid: 'Owner pays',
  tenant_paid_direct: 'Tenant pays directly',
  tenant_prepaid: 'Tenant prepaid (voucher/token)',
  included_in_rent: 'Included in rent',
  common_area_owner: 'Common area (owner)',
};

// common_area_owner is inherently property-wide (migration 163's own CHECK constraint rejects it
// on a unit-scoped row) -- excluded from this unit-level picker rather than offered and rejected.
const UNIT_RESPONSIBILITY_MODES = (Object.keys(RESPONSIBILITY_LABELS) as UtilityResponsibilityMode[]).filter(
  (mode) => mode !== 'common_area_owner',
);

export function UnitFinancesPanel({
  propertyId,
  unitId,
  orgId,
  canManage,
}: {
  propertyId: string;
  unitId: string;
  orgId: string;
  canManage: boolean;
}) {
  const [costs, setCosts] = useState<RecurringPropertyCost[]>([]);
  const [settings, setSettings] = useState<UtilityResponsibilitySetting[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [waterMode, setWaterMode] = useState<UtilityResponsibilityMode>('owner_paid');
  const [electricityMode, setElectricityMode] = useState<UtilityResponsibilityMode>('owner_paid');

  const load = useCallback(async () => {
    setError(null);
    const [costsRes, settingsRes] = await Promise.all([
      fetch(`/api/v1/properties/${propertyId}/recurring-costs?unitId=${unitId}`),
      fetch(`/api/v1/properties/${propertyId}/utility-settings?unitId=${unitId}`),
    ]);
    const costsBody = await safeJson(costsRes);
    const settingsBody = await safeJson(settingsRes);
    if (costsBody) setCosts(costsBody.recurringCosts ?? []);
    if (settingsBody) setSettings(settingsBody.utilitySettings ?? []);
    setLoaded(true);
  }, [propertyId, unitId]);

  useEffect(() => {
    load();
  }, [load]);

  const currentRates = costs.find((c) => c.costType === 'rates_and_taxes' && !c.effectiveTo);
  const currentLevy = costs.find((c) => c.costType === 'levy' && !c.effectiveTo);
  const currentWater = settings.find((s) => s.utilityType === 'water');
  const currentElectricity = settings.find((s) => s.utilityType === 'electricity');

  async function setCost(costType: 'rates_and_taxes' | 'levy', amount: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/recurring-costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          unitId,
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
        body: JSON.stringify({ orgId, unitId, utilityType, responsibilityMode: mode }),
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

  if (!loaded) {
    return (
      <Panel title="Finances">
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

      <Panel title="Rates, taxes & levy">
        <p className="mb-3 text-xs text-muted-foreground">
          For a sectional-title unit owned individually. Leave blank if not applicable -- e.g. a
          whole-building owner sets rates at the property level instead, and levies may not apply
          at all.
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

      <Panel title="Utility responsibility">
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
        {UNIT_RESPONSIBILITY_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {RESPONSIBILITY_LABELS[mode]}
          </option>
        ))}
      </select>
    </label>
  );
}
