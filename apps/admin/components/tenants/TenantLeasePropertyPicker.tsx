'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

export interface PropertyOption {
  id: string;
  nickname: string;
}
export interface UnitOption {
  id: string;
  propertyId: string;
  unitLabel: string;
  status: 'vacant' | 'occupied' | 'maintenance' | 'archived';
}

// Overnight V1 completion pass (WORKLOG.md this date), Part A gap 2: the existing lease-creation
// choice page (/properties/:id/units/:unitId/leases/new) is unit-scoped -- reachable from the
// tenant side, the property/unit aren't known yet. This is purely a thin picker that hands off to
// that EXISTING, unchanged flow the instant both are chosen -- no new lease architecture, no
// competing form. Archived units are excluded (same "not available for new tenancy" rule the
// archived-unit activation guard already enforces server-side, migration 20260101000150) --
// filtered here so the picker itself never offers a choice the next step would just reject.
export function TenantLeasePropertyPicker({
  tenantId,
  properties,
  units,
}: {
  tenantId: string;
  properties: PropertyOption[];
  units: UnitOption[];
}) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState('');
  const [unitId, setUnitId] = useState('');

  const availableUnits = useMemo(
    () => units.filter((u) => u.propertyId === propertyId && u.status !== 'archived'),
    [units, propertyId],
  );

  function proceed(destination: 'prepare' | 'existing') {
    if (!propertyId || !unitId) return;
    const suffix = destination === 'existing' ? '/existing' : '/prepare';
    router.push(
      `/properties/${propertyId}/units/${unitId}/leases/new${suffix}?tenantId=${tenantId}`,
    );
  }

  return (
    <Panel className="max-w-xl" title="Where does this tenant live?">
      <div className="space-y-4">
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Property</span>
          <select
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value);
              setUnitId('');
            }}
            className={inputClass}
          >
            <option value="">Select a property…</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nickname}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Unit</span>
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            disabled={!propertyId}
            className={inputClass}
          >
            <option value="">{propertyId ? 'Select a unit…' : 'Choose a property first'}</option>
            {availableUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitLabel} ({u.status})
              </option>
            ))}
          </select>
          {propertyId && availableUnits.length === 0 ? (
            <p className="mt-1 text-[11px] text-light-textMuted dark:text-dark-textMuted">
              No available units on this property yet.
            </p>
          ) : null}
        </label>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            type="button"
            variant="primary"
            disabled={!propertyId || !unitId}
            onClick={() => proceed('existing')}
          >
            Record existing lease
          </Button>
          <Button type="button" disabled={!propertyId || !unitId} onClick={() => proceed('prepare')}>
            Create new lease
          </Button>
        </div>
      </div>
    </Panel>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
