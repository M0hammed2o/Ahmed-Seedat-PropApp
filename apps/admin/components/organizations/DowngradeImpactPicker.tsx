'use client';

import { useMemo } from 'react';

export interface DowngradeResourceItem {
  id: string;
  label: string;
}

export interface DowngradeResourceImpact {
  currentUsage: number;
  newAllowance: number | null;
  overBy: number;
  items: DowngradeResourceItem[];
}

export interface DowngradeImpact {
  properties: DowngradeResourceImpact;
  staff: DowngradeResourceImpact;
  owners: DowngradeResourceImpact;
  requiresSelection: boolean;
}

export interface DowngradeSelection {
  propertyIds: string[];
  staffMemberIds: string[];
  ownerIds: string[];
}

interface Props {
  impact: DowngradeImpact;
  selection: DowngradeSelection;
  onChange: (selection: DowngradeSelection) => void;
}

const SECTIONS: {
  key: 'properties' | 'staff' | 'owners';
  selectionKey: keyof DowngradeSelection;
  singular: string;
  plural: string;
}[] = [
  { key: 'properties', selectionKey: 'propertyIds', singular: 'property', plural: 'properties' },
  { key: 'staff', selectionKey: 'staffMemberIds', singular: 'staff member', plural: 'staff' },
  { key: 'owners', selectionKey: 'ownerIds', singular: 'external owner', plural: 'external owners' },
];

/**
 * V1 commercial UX pass -- "do not permit a misleading one-click downgrade confirmation that
 * hides the effect... allow principal to select which resources remain operational." Rendered
 * only when impact.requiresSelection is true (some resource type is over the target plan's
 * allowance). Each over-limit section pre-checks the first `newAllowance` items (oldest first,
 * items are already ordered that way by computeDowngradeImpact()) -- exactly
 * reconcile_plan_limits()'s own deterministic default -- so a customer who changes nothing still
 * sees, and implicitly confirms, precisely what will happen before clicking Confirm.
 */
export function DowngradeImpactPicker({ impact, selection, onChange }: Props) {
  const sections = useMemo(
    () => SECTIONS.filter((s) => impact[s.key].overBy > 0),
    [impact],
  );

  if (sections.length === 0) return null;

  function toggle(selectionKey: keyof DowngradeSelection, id: string, allowance: number) {
    const current = selection[selectionKey];
    const isChecked = current.includes(id);
    if (isChecked) {
      onChange({ ...selection, [selectionKey]: current.filter((x) => x !== id) });
      return;
    }
    if (current.length >= allowance) return;
    onChange({ ...selection, [selectionKey]: [...current, id] });
  }

  return (
    <div className="mt-4 space-y-4 rounded-card border border-light-warning bg-light-warning/5 p-4 dark:border-dark-warning dark:bg-dark-warning/5">
      <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Your new plan has lower limits than your current usage.
      </p>
      {sections.map((s) => {
        const impactForSection = impact[s.key];
        const checked = selection[s.selectionKey];
        const allowance = impactForSection.newAllowance ?? 0;
        return (
          <div key={s.key}>
            <p className="text-xs text-light-textSecondary dark:text-dark-textSecondary">
              {s.key === 'properties' ? 'Properties' : s.key === 'staff' ? 'Staff' : 'Owners'}:{' '}
              <span className="font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                {impactForSection.currentUsage} in use / {allowance} allowed
              </span>
            </p>
            <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
              Choose up to {allowance} {allowance === 1 ? s.singular : s.plural} to keep active.
              The rest will be restricted (not deleted) until you upgrade or add capacity. Selected:{' '}
              {checked.length}/{allowance}.
            </p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-light-border p-2 dark:border-dark-border">
              {impactForSection.items.map((item) => {
                const isChecked = checked.includes(item.id);
                const disableUnchecked = !isChecked && checked.length >= allowance;
                return (
                  <li key={item.id}>
                    <label className="flex items-center gap-2 text-sm text-light-textPrimary dark:text-dark-textPrimary">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={disableUnchecked}
                        onChange={() => toggle(s.selectionKey, item.id, allowance)}
                      />
                      <span className={disableUnchecked ? 'opacity-50' : ''}>{item.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Deterministic default selection -- the first `newAllowance` items of each over-limit resource
 * type, oldest first (items already arrive in that order). Used to pre-check the picker so a
 * customer who changes nothing still submits exactly what reconcile_plan_limits()'s own fallback
 * would have chosen -- shown explicitly, never silently applied. */
export function defaultDowngradeSelection(impact: DowngradeImpact): DowngradeSelection {
  return {
    propertyIds: impact.properties.items.slice(0, impact.properties.newAllowance ?? 0).map((i) => i.id),
    staffMemberIds: impact.staff.items.slice(0, impact.staff.newAllowance ?? 0).map((i) => i.id),
    ownerIds: impact.owners.items.slice(0, impact.owners.newAllowance ?? 0).map((i) => i.id),
  };
}
