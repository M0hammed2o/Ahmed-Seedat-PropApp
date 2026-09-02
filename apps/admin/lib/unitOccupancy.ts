import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// Proplyst Mobile Design System redesign pass: real per-property unit/occupancy counts for the
// Properties grid card ("n units / % let" stat) and property detail summary. Plain counts of
// existing rows -- `units` and `leases.status = 'active'` -- never a financial calculation, so this
// does not touch the "backend remains authoritative for invoice/payment amounts" boundary at all.

export interface UnitOccupancy {
  unitCount: number;
  occupiedUnitCount: number;
}

/**
 * Batch unit + occupied-unit counts for a set of properties, in two queries total regardless of
 * how many properties are passed (never N+1). "Occupied" means the unit has at least one lease
 * currently `status = 'active'` -- the same status a lease reaches through the existing lease
 * lifecycle, not a new state invented for this feature. `supabase` must be the caller's own
 * session-bound client (RLS-scoped), same posture as every other reader in this codebase.
 */
export async function loadUnitOccupancyByProperty(
  supabase: SupabaseClient,
  propertyIds: string[],
): Promise<Map<string, UnitOccupancy>> {
  const result = new Map<string, UnitOccupancy>();
  if (propertyIds.length === 0) return result;

  const { data: units } = await supabase.from('units').select('id, property_id').in('property_id', propertyIds);
  const unitRows = (units ?? []) as { id: string; property_id: string }[];
  if (unitRows.length === 0) return result;

  const unitToProperty = new Map(unitRows.map((u) => [u.id, u.property_id] as const));
  for (const propertyId of propertyIds) {
    result.set(propertyId, { unitCount: 0, occupiedUnitCount: 0 });
  }
  for (const unit of unitRows) {
    const entry = result.get(unit.property_id);
    if (entry) entry.unitCount += 1;
  }

  const { data: leases } = await supabase
    .from('leases')
    .select('unit_id')
    .in('unit_id', unitRows.map((u) => u.id))
    .eq('status', 'active');
  const leaseRows = (leases ?? []) as { unit_id: string }[];

  const occupiedUnitIds = new Set<string>();
  for (const lease of leaseRows) {
    if (occupiedUnitIds.has(lease.unit_id)) continue; // a unit with >1 active lease counts once
    occupiedUnitIds.add(lease.unit_id);
    const propertyId = unitToProperty.get(lease.unit_id);
    const entry = propertyId ? result.get(propertyId) : undefined;
    if (entry) entry.occupiedUnitCount += 1;
  }

  return result;
}
