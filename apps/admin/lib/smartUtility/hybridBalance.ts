// Hybrid energy / water balance (docs/HYBRID_UTILITIES_ARCHITECTURE.md §C). Pure. Inputs are per-meter period
// consumptions (from the consumption engine) grouped by measurement kind, plus tank levels and logged deliveries.
// Every figure carries a basis so the UI never presents a derived estimate as a measured reading, and nothing
// here labels a variance as a leak, theft or tampering.

export type Basis = 'measured' | 'derived' | 'logged' | 'missing';

export interface Figure {
  value: number | null;
  basis: Basis;
}

export interface BalanceMeter {
  id: string;
  label: string;
  utilityType: 'water' | 'electricity';
  measurementKind: string;
  meterRole: 'main' | 'submeter' | 'check';
  parentMeterId: string | null;
  unitId: string | null;
  sourceType: string | null;
  /** display units (kWh / kL); null when it could not be calculated */
  consumption: number | null;
  quality: 'complete' | 'partial' | 'insufficient';
}

export interface BalanceSource {
  id: string;
  name: string;
  utilityType: 'water' | 'electricity';
  sourceType: string;
  active: boolean;
}

export interface TankLevels {
  sourceId: string;
  /** litres at period start / end; null when unknown */
  startLitres: number | null;
  endLitres: number | null;
}

export interface DataGap {
  kind: 'meter_incomplete' | 'meter_missing_data' | 'source_not_metered' | 'tank_level_unknown' | 'no_consumption_meters';
  label: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function sumKind(meters: BalanceMeter[], kind: string, gaps: DataGap[], filter?: (m: BalanceMeter) => boolean): Figure {
  const ms = meters.filter((m) => m.measurementKind === kind && (!filter || filter(m)));
  if (ms.length === 0) return { value: null, basis: 'missing' };
  let total = 0;
  let missing = 0;
  for (const m of ms) {
    if (m.consumption === null) {
      missing += 1;
      gaps.push({ kind: 'meter_missing_data', label: m.label });
    } else {
      total += m.consumption;
      if (m.quality !== 'complete') gaps.push({ kind: 'meter_incomplete', label: m.label });
    }
  }
  return { value: missing === ms.length ? null : r3(total), basis: missing === ms.length ? 'missing' : 'measured' };
}

/** Top-of-hierarchy consumption: main/check consumption meters without a parent, else every unit submeter. */
function measuredConsumption(meters: BalanceMeter[], gaps: DataGap[]): Figure & { scope: 'main_meters' | 'unit_meters' | 'none' } {
  const cons = meters.filter((m) => m.measurementKind === 'consumption');
  const top = cons.filter((m) => (m.meterRole === 'main' || m.meterRole === 'check') && !m.parentMeterId);
  if (top.length) return { ...sumKind(top, 'consumption', gaps), scope: 'main_meters' };
  const units = cons.filter((m) => m.meterRole === 'submeter');
  if (units.length) return { ...sumKind(units, 'consumption', gaps), scope: 'unit_meters' };
  gaps.push({ kind: 'no_consumption_meters', label: 'No consumption meters' });
  return { value: null, basis: 'missing', scope: 'none' };
}

const val = (f: Figure) => f.value ?? 0;

export interface ElectricityBalance {
  gridImport: Figure;
  gridExport: Figure;
  generation: Figure;
  generatorOutput: Figure;
  batteryCharge: Figure;
  batteryDischarge: Figure;
  /** energy that entered the site net of exports and storage */
  siteSupply: Figure;
  /** solar used directly on site (derived; assumes the battery charges from solar first) */
  solarSelfConsumption: Figure;
  measuredConsumption: Figure & { scope: string };
  variance: Figure;
  variancePct: number | null;
  contribution: { grid: number | null; solar: number | null; battery: number | null; generator: number | null };
  pumpEnergy: Figure;
  gaps: DataGap[];
  notes: string[];
}

export function electricityBalance(meters: BalanceMeter[], sources: BalanceSource[]): ElectricityBalance {
  const m = meters.filter((x) => x.utilityType === 'electricity');
  const gaps: DataGap[] = [];
  const notes: string[] = [];
  const gridImport = sumKind(m, 'grid_import', gaps);
  const gridExport = sumKind(m, 'grid_export', gaps);
  const generation = sumKind(m, 'generation', gaps);
  const generatorOutput = sumKind(m, 'generator_output', gaps);
  const batteryCharge = sumKind(m, 'battery_charge', gaps);
  const batteryDischarge = sumKind(m, 'battery_discharge', gaps);
  const pumpEnergy = sumKind(m, 'pump_energy', gaps);

  for (const s of sources.filter((x) => x.utilityType === 'electricity' && x.active)) {
    const kind =
      s.sourceType === 'solar_pv' ? 'generation' : s.sourceType === 'generator' ? 'generator_output' : s.sourceType === 'battery' ? 'battery_discharge' : 'grid_import';
    if (!m.some((x) => x.measurementKind === kind || (kind === 'grid_import' && x.measurementKind === 'consumption'))) {
      gaps.push({ kind: 'source_not_metered', label: s.name });
    }
  }

  const anySource = [gridImport, generation, generatorOutput, batteryDischarge].some((f) => f.basis !== 'missing');
  const siteSupplyValue = r3(val(gridImport) + val(generation) + val(generatorOutput) + val(batteryDischarge) - val(gridExport) - val(batteryCharge));
  const siteSupply: Figure = anySource ? { value: siteSupplyValue, basis: 'derived' } : { value: null, basis: 'missing' };

  let solarSelf: Figure = { value: null, basis: 'missing' };
  if (generation.basis !== 'missing') {
    const raw = val(generation) - val(gridExport) - val(batteryCharge);
    solarSelf = { value: r3(Math.max(0, raw)), basis: 'derived' };
    if (raw < 0) notes.push('Exports and battery charging exceed solar generation: the battery or exports were partly grid/generator-fed.');
  }

  const consumption = measuredConsumption(m, gaps);
  // When there are no source meters at all, a main consumption meter IS the grid supply (simple municipal sites).
  const effectiveSupply = siteSupply.value === null ? consumption.value : siteSupply.value;
  const variance: Figure =
    siteSupply.value !== null && consumption.value !== null ? { value: r3(siteSupply.value - consumption.value), basis: 'derived' } : { value: null, basis: 'missing' };
  const variancePct = variance.value !== null && siteSupply.value ? Math.round((variance.value / siteSupply.value) * 10_000) / 100 : null;

  const total = effectiveSupply ?? null;
  const share = (n: number | null) => (n === null || !total ? null : Math.round((n / total) * 10_000) / 100);
  const contribution = {
    grid: share(gridImport.basis === 'missing' ? (siteSupply.value === null ? consumption.value : null) : val(gridImport)),
    solar: share(solarSelf.value),
    battery: share(batteryDischarge.value),
    generator: share(generatorOutput.value),
  };
  if (batteryCharge.value) notes.push('Battery charging is subtracted once (energy stored) and discharging added once (energy released): stored solar is not double counted.');

  return {
    gridImport,
    gridExport,
    generation,
    generatorOutput,
    batteryCharge,
    batteryDischarge,
    siteSupply,
    solarSelfConsumption: solarSelf,
    measuredConsumption: consumption,
    variance,
    variancePct,
    contribution,
    pumpEnergy,
    gaps: dedupe(gaps),
    notes,
  };
}

export interface WaterBalance {
  bySource: { sourceType: string; label: string; volume: Figure }[];
  totalSupply: Figure;
  storageChange: Figure;
  /** supply minus storage change: indicative only (tank levels are not billing-grade) */
  siteUse: Figure;
  measuredConsumption: Figure & { scope: string };
  variance: Figure;
  variancePct: number | null;
  internalTransfers: Figure;
  gaps: DataGap[];
  notes: string[];
}

export function waterBalance(
  meters: BalanceMeter[],
  sources: BalanceSource[],
  tanks: TankLevels[],
  loggedDeliveriesKl: { sourceId: string; kl: number }[],
): WaterBalance {
  const m = meters.filter((x) => x.utilityType === 'water');
  const gaps: DataGap[] = [];
  const notes: string[] = [];
  const supplyTypes = ['municipal', 'borehole', 'rainwater', 'tanker', 'other'];
  const bySource: WaterBalance['bySource'] = [];
  for (const st of supplyTypes) {
    const fig = sumKind(m, 'source_supply', gaps, (x) => (x.sourceType ?? 'other') === st);
    let figure = fig;
    if (fig.basis === 'missing' && st === 'tanker') {
      // Every logged tanker delivery is tanker supply, whichever source it was logged on (usually the tank it
      // filled). Not added when a tanker inlet is metered, so a delivery is never counted twice.
      const kl = loggedDeliveriesKl.reduce((a, d) => a + d.kl, 0);
      if (kl > 0) figure = { value: r3(kl), basis: 'logged' };
    }
    if (figure.basis !== 'missing') bySource.push({ sourceType: st, label: st, volume: figure });
  }
  for (const s of sources.filter((x) => x.utilityType === 'water' && x.active && x.sourceType !== 'storage_tank')) {
    if (!bySource.some((b) => b.sourceType === s.sourceType)) gaps.push({ kind: 'source_not_metered', label: s.name });
  }
  const supplyKnown = bySource.length > 0;
  const totalSupply: Figure = supplyKnown
    ? { value: r3(bySource.reduce((a, b) => a + val(b.volume), 0)), basis: bySource.every((b) => b.volume.basis === 'measured') ? 'measured' : 'derived' }
    : { value: null, basis: 'missing' };

  let storageChange: Figure = { value: 0, basis: 'derived' };
  const tankSources = sources.filter((s) => s.utilityType === 'water' && s.sourceType === 'storage_tank' && s.active);
  if (tankSources.length) {
    let delta = 0;
    let unknown = false;
    for (const t of tankSources) {
      const lv = tanks.find((x) => x.sourceId === t.id);
      if (!lv || lv.startLitres === null || lv.endLitres === null) {
        unknown = true;
        gaps.push({ kind: 'tank_level_unknown', label: t.name });
      } else delta += (lv.endLitres - lv.startLitres) / 1000;
    }
    storageChange = unknown ? { value: null, basis: 'missing' } : { value: r3(delta), basis: 'derived' };
    notes.push('Tank level changes are indicative only and never used for billing.');
  }

  const siteUse: Figure =
    totalSupply.value !== null && storageChange.value !== null
      ? { value: r3(totalSupply.value - storageChange.value), basis: 'derived' }
      : { value: null, basis: 'missing' };
  const internal = sumKind(m, 'transfer', gaps);
  const inflow = sumKind(m, 'tank_inflow', gaps);
  const outflow = sumKind(m, 'tank_outflow', gaps);
  const internalTransfers: Figure =
    [internal, inflow, outflow].some((f) => f.basis !== 'missing') ? { value: r3(val(internal) + val(inflow) + val(outflow)), basis: 'measured' } : { value: null, basis: 'missing' };
  if (internalTransfers.value) notes.push('Tank inflow/outflow and transfers are internal movements and are not added to supply.');

  const consumption = measuredConsumption(m, gaps);
  const reference = siteUse.value ?? null;
  const variance: Figure = reference !== null && consumption.value !== null ? { value: r3(reference - consumption.value), basis: 'derived' } : { value: null, basis: 'missing' };
  const variancePct = variance.value !== null && reference ? Math.round((variance.value / reference) * 10_000) / 100 : null;

  return { bySource, totalSupply, storageChange, siteUse, measuredConsumption: consumption, variance, variancePct, internalTransfers, gaps: dedupe(gaps), notes };
}

function dedupe(gaps: DataGap[]): DataGap[] {
  const seen = new Set<string>();
  return gaps.filter((g) => {
    const k = `${g.kind}|${g.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
