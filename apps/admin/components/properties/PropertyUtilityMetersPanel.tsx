'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { UtilityMeter, UtilityResponsibilityMode, UtilityHistoryPoint } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { safeJson } from '@/lib/safeJson';

// Continuation pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §12, UTILITIES_RATES_BUDGET_IMPLEMENTATION.md).
// The web app previously had ZERO utility-meter UI at all -- Android's own Utility Capture screen
// pointed owners here ("Add one from Properties → Finances on the web app") but nothing existed to
// add one with. This is that missing piece: create/list meters, record a reading, view history with
// the server-computed anomaly flag. Reuses the existing utility-meters/readings API unchanged.

const RESPONSIBILITY_LABELS: Record<UtilityResponsibilityMode, string> = {
  owner_paid: 'Owner pays',
  tenant_paid_direct: 'Tenant pays directly',
  tenant_prepaid: 'Tenant prepaid (voucher/token)',
  included_in_rent: 'Included in rent',
  common_area_owner: 'Common area (owner)',
};

interface UnitOption {
  id: string;
  unitLabel: string;
}

export function PropertyUtilityMetersPanel({
  propertyId,
  orgId,
  units,
  canManage,
}: {
  propertyId: string;
  orgId: string;
  units: UnitOption[];
  canManage: boolean;
}) {
  const [meters, setMeters] = useState<UtilityMeter[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedMeterId, setExpandedMeterId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newUtilityType, setNewUtilityType] = useState<'water' | 'electricity'>('water');
  const [newUnitId, setNewUnitId] = useState('');
  const [newMeterNumber, setNewMeterNumber] = useState('');
  const [newResponsibility, setNewResponsibility] = useState<UtilityResponsibilityMode>('owner_paid');
  const [newIsPrepaid, setNewIsPrepaid] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/v1/properties/${propertyId}/utility-meters`);
    const body = await safeJson(response);
    if (body?.utilityMeters) setMeters(body.utilityMeters);
    setLoaded(true);
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/utility-meters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          utilityType: newUtilityType,
          unitId: newUnitId || null,
          meterNumber: newMeterNumber || null,
          responsibilityMode: newResponsibility,
          isPrepaid: newIsPrepaid,
        }),
      });
      if (!response.ok) {
        const body = await safeJson(response);
        setError(body?.error?.message ?? 'Could not add this meter.');
        return;
      }
      setNewMeterNumber('');
      setShowCreate(false);
      await load();
    } finally {
      setCreating(false);
    }
  }

  if (!loaded) {
    return (
      <Panel title="Utility meters">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </Panel>
    );
  }

  return (
    <Panel title="Utility meters">
      {error ? (
        <div className="mb-3 rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </div>
      ) : null}

      {meters.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">
          No meters yet. A meter is only needed when consumption is actually tracked -- if water or
          electricity here is tenant-paid direct or tenant-prepaid, no meter is required.
        </p>
      ) : (
        <div className="mb-3 space-y-2">
          {meters.map((meter) => (
            <MeterRow
              key={meter.id}
              meter={meter}
              unitLabel={units.find((u) => u.id === meter.unitId)?.unitLabel}
              expanded={expandedMeterId === meter.id}
              onToggle={() => setExpandedMeterId(expandedMeterId === meter.id ? null : meter.id)}
              canManage={canManage}
            />
          ))}
        </div>
      )}

      {canManage ? (
        showCreate ? (
          <form onSubmit={handleCreate} className="space-y-3 rounded-md border border-light-border p-3 text-xs dark:border-dark-border">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-muted-foreground">Utility</span>
                <select
                  value={newUtilityType}
                  onChange={(e) => setNewUtilityType(e.target.value as 'water' | 'electricity')}
                  className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
                >
                  <option value="water">Water</option>
                  <option value="electricity">Electricity</option>
                </select>
              </label>
              <label className="block">
                <span className="text-muted-foreground">Unit (blank = property-wide / common area)</span>
                <select
                  value={newUnitId}
                  onChange={(e) => setNewUnitId(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
                >
                  <option value="">Whole property</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.unitLabel}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-muted-foreground">Meter number (optional)</span>
                <input
                  value={newMeterNumber}
                  onChange={(e) => setNewMeterNumber(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">Responsibility</span>
                <select
                  value={newResponsibility}
                  onChange={(e) => setNewResponsibility(e.target.value as UtilityResponsibilityMode)}
                  className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
                >
                  {(Object.keys(RESPONSIBILITY_LABELS) as UtilityResponsibilityMode[])
                    .filter((mode) => mode !== 'common_area_owner' || !newUnitId)
                    .map((mode) => (
                      <option key={mode} value={mode}>
                        {RESPONSIBILITY_LABELS[mode]}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={newIsPrepaid} onChange={(e) => setNewIsPrepaid(e.target.checked)} />
              <span>Prepaid meter (voucher/token)</span>
            </label>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={creating}>
                {creating ? 'Adding...' : 'Add meter'}
              </Button>
              <Button type="button" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" onClick={() => setShowCreate(true)}>
            + Add meter
          </Button>
        )
      ) : null}
    </Panel>
  );
}

function MeterRow({
  meter,
  unitLabel,
  expanded,
  onToggle,
  canManage,
}: {
  meter: UtilityMeter;
  unitLabel: string | undefined;
  expanded: boolean;
  onToggle: () => void;
  canManage: boolean;
}) {
  return (
    <div className="rounded-md border border-light-border dark:border-dark-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
      >
        <span>
          <span className="font-medium capitalize">{meter.utilityType}</span>
          {meter.meterNumber ? <span className="text-muted-foreground"> · {meter.meterNumber}</span> : null}
          {unitLabel ? <span className="text-muted-foreground"> · {unitLabel}</span> : <span className="text-muted-foreground"> · Whole property</span>}
        </span>
        <span className="text-xs text-muted-foreground">
          {RESPONSIBILITY_LABELS[meter.responsibilityMode]}
          {meter.isPrepaid ? ' · Prepaid' : ''}
        </span>
      </button>
      {expanded ? <MeterReadings meterId={meter.id} utilityType={meter.utilityType} canManage={canManage} /> : null}
    </div>
  );
}

function MeterReadings({
  meterId,
  utilityType,
  canManage,
}: {
  meterId: string;
  utilityType: string;
  canManage: boolean;
}) {
  const [history, setHistory] = useState<UtilityHistoryPoint[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodMonth, setPeriodMonth] = useState('');
  const [readingDate, setReadingDate] = useState('');
  const [readingValue, setReadingValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const unitOfMeasure = utilityType === 'water' ? 'L' : 'kWh';

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/utility-meters/${meterId}/readings`);
    const body = await safeJson(response);
    if (body?.history) setHistory(body.history);
    setLoaded(true);
  }, [meterId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/utility-meters/${meterId}/readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodMonth,
          readingDate,
          readingValue: Number(readingValue),
          unitOfMeasure,
          source: 'manual',
        }),
      });
      if (!response.ok) {
        const body = await safeJson(response);
        setError(body?.error?.message ?? 'Could not record this reading.');
        return;
      }
      setReadingValue('');
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t border-light-border p-3 dark:border-dark-border">
      {error ? <p className="mb-2 text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}
      {!loaded ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : history.length === 0 ? (
        <p className="mb-2 text-xs text-muted-foreground">No readings yet.</p>
      ) : (
        <ul className="mb-3 space-y-1 text-xs">
          {[...history].reverse().slice(0, 6).map((point) => (
            <li key={point.periodMonth} className="flex items-center justify-between">
              <span>{point.periodMonth}</span>
              <span>
                {point.consumption !== null ? `${point.consumption} ${unitOfMeasure}` : '—'}
                {point.percentChange !== null ? ` (${point.percentChange > 0 ? '+' : ''}${point.percentChange}%)` : ''}
                {point.isUnusualUsage ? (
                  <span className="ml-1 text-light-warning dark:text-dark-warning">Unusual usage</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form onSubmit={handleSubmit} className="grid grid-cols-4 items-end gap-2 text-xs">
          <label className="block">
            <span className="text-muted-foreground">Period (YYYY-MM-01)</span>
            <input
              required
              value={periodMonth}
              onChange={(e) => setPeriodMonth(e.target.value)}
              placeholder="2026-09-01"
              className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-2 py-1.5 dark:border-dark-border"
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground">Reading date</span>
            <input
              required
              type="date"
              value={readingDate}
              onChange={(e) => setReadingDate(e.target.value)}
              className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-2 py-1.5 dark:border-dark-border"
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground">Reading ({unitOfMeasure})</span>
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={readingValue}
              onChange={(e) => setReadingValue(e.target.value)}
              className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-2 py-1.5 dark:border-dark-border"
            />
          </label>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save reading'}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
