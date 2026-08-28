'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { ApplicationForm } from './ApplicationForm';

interface PropertyOption {
  id: string;
  nickname: string;
}

interface UnitOption {
  id: string;
  propertyId: string;
  unitLabel: string;
  marketRent: number | null;
}

function currency(n: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(n);
}

const selectClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';

/**
 * V1 launch-completion pass, Section 1/2: Applications -> New application -> Choose property ->
 * Choose eligible/vacant unit -> Applicant details -> Create application. Only handles the
 * property/unit choice and clearly displaying what was chosen (never a raw UUID) -- the actual
 * applicant-details form and creation call are the existing, unmodified ApplicationForm/
 * POST /api/v1/applications, reused as-is once both selections are made.
 */
export function NewApplicationPicker({
  orgId,
  properties,
  units,
  initialPropertyId,
}: {
  orgId: string;
  properties: PropertyOption[];
  units: UnitOption[];
  initialPropertyId: string | null;
}) {
  const [propertyId, setPropertyId] = useState(initialPropertyId ?? '');
  const [unitId, setUnitId] = useState('');

  const unitsForProperty = useMemo(
    () => units.filter((u) => u.propertyId === propertyId),
    [units, propertyId],
  );
  const selectedProperty = properties.find((p) => p.id === propertyId);
  const selectedUnit = units.find((u) => u.id === unitId);

  if (propertyId && unitId && selectedProperty && selectedUnit) {
    return (
      <div>
        <PageHeader title="New application" subtitle={`${selectedProperty.nickname} — ${selectedUnit.unitLabel}`} />
        {selectedUnit.marketRent !== null ? (
          <p className="mt-1 text-[13px] text-muted-foreground">
            Market rent: <span className="tabular font-medium text-foreground">{currency(selectedUnit.marketRent)}</span>
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => setUnitId('')}
          className="mt-2 text-[12px] font-medium text-primary hover:underline"
        >
          ← Choose a different unit
        </button>
        <div className="mt-4">
          <ApplicationForm orgId={orgId} propertyId={propertyId} unitId={unitId} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="New application" subtitle="Choose the property and vacant unit this applicant is applying for." />

      <div className="mt-6 max-w-xl space-y-4">
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Property</span>
          <select
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value);
              setUnitId('');
            }}
            className={selectClass}
          >
            <option value="">Select a property…</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nickname}
              </option>
            ))}
          </select>
        </label>

        {propertyId ? (
          unitsForProperty.length > 0 ? (
            <label className="block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">Vacant unit</span>
              <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={selectClass}>
                <option value="">Select a unit…</option>
                {unitsForProperty.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.unitLabel}
                    {u.marketRent !== null ? ` — ${currency(u.marketRent)}/month` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="rounded-md border border-light-border bg-light-surface px-3 py-2 text-[13px] text-muted-foreground dark:border-dark-border dark:bg-dark-surface">
              This property has no vacant units right now. Applications can only be started for a
              unit that isn&apos;t currently occupied.
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}
