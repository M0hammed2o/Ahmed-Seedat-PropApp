import { describe, expect, it } from 'vitest';
import { electricityBalance, waterBalance, type BalanceMeter, type BalanceSource } from '../hybridBalance';

// Realistic SA hybrid sites (figures illustrative): solar + battery + grid, generator during load-shedding,
// borehole + municipal + storage tanks + tanker deliveries.

const meter = (id: string, kind: string, consumption: number | null, extra: Partial<BalanceMeter> = {}): BalanceMeter => ({
  id,
  label: id,
  utilityType: extra.utilityType ?? (['source_supply', 'tank_inflow', 'tank_outflow'].includes(kind) ? 'water' : 'electricity'),
  measurementKind: kind,
  meterRole: 'main',
  parentMeterId: null,
  unitId: null,
  sourceType: null,
  consumption,
  quality: consumption === null ? 'insufficient' : 'complete',
  ...extra,
});
const src = (id: string, utilityType: 'water' | 'electricity', sourceType: string): BalanceSource => ({ id, name: id, utilityType, sourceType, active: true });

describe('electricity balance (no double counting)', () => {
  // Month: grid import 1 200 kWh, solar 900 kWh, exported 100 kWh, battery charged 300 kWh and discharged 270 kWh
  // (90 % round trip), generator 50 kWh during load-shedding. Main consumption meter: 1 790 kWh.
  const meters = [
    meter('grid-in', 'grid_import', 1200),
    meter('grid-out', 'grid_export', 100),
    meter('pv', 'generation', 900),
    meter('bat-in', 'battery_charge', 300),
    meter('bat-out', 'battery_discharge', 270),
    meter('genset', 'generator_output', 50),
    meter('main', 'consumption', 1790),
  ];

  it('nets exports and storage so stored solar is counted once', () => {
    const b = electricityBalance(meters, []);
    // 1200 + 900 + 50 + 270 − 100 − 300 = 2 020 kWh entered the site net
    expect(b.siteSupply).toEqual({ value: 2020, basis: 'derived' });
    expect(b.solarSelfConsumption).toEqual({ value: 500, basis: 'derived' }); // 900 − 100 − 300
    expect(b.measuredConsumption.value).toBe(1790);
    expect(b.variance.value).toBe(230); // losses / unmetered loads — not labelled theft
    expect(b.variancePct).toBe(11.39);
    // contributions of 2 020: grid 1200, solar 500, battery 270, generator 50 → sum 2020
    expect(b.contribution).toEqual({ grid: 59.41, solar: 24.75, battery: 13.37, generator: 2.48 });
  });

  it('treats a lone municipal consumption meter as the whole supply and reports unmetered sources as gaps', () => {
    const b = electricityBalance([meter('main', 'consumption', 640)], [src('Solar array', 'electricity', 'solar_pv')]);
    expect(b.siteSupply.basis).toBe('missing');
    expect(b.contribution.grid).toBe(100);
    expect(b.gaps).toEqual([{ kind: 'source_not_metered', label: 'Solar array' }]);
  });

  it('marks meters without data as gaps instead of counting zero', () => {
    const b = electricityBalance([meter('grid-in', 'grid_import', null), meter('main', 'consumption', 500)], []);
    expect(b.gridImport).toEqual({ value: null, basis: 'missing' });
    expect(b.gaps.map((g) => g.kind)).toContain('meter_missing_data');
  });

  it('notes when exports + battery charging exceed solar (grid-charged battery)', () => {
    const b = electricityBalance([meter('pv', 'generation', 100), meter('bat-in', 'battery_charge', 300), meter('grid-in', 'grid_import', 500)], []);
    expect(b.solarSelfConsumption.value).toBe(0);
    expect(b.notes.join(' ')).toMatch(/grid\/generator-fed/);
  });

  it('never adds borehole pump energy to supply', () => {
    const b = electricityBalance([meter('grid-in', 'grid_import', 1000), meter('pump', 'pump_energy', 120), meter('main', 'consumption', 1000)], []);
    expect(b.siteSupply.value).toBe(1000);
    expect(b.pumpEnergy.value).toBe(120);
  });
});

describe('water balance (no double counting)', () => {
  const sources = [
    src('Municipal connection', 'water', 'municipal'),
    src('Borehole', 'water', 'borehole'),
    src('Tank 10kL', 'water', 'storage_tank'),
    src('Tanker', 'water', 'tanker'),
  ];
  it('sums sources, subtracts storage change, and ignores internal tank transfers', () => {
    const meters = [
      meter('muni', 'source_supply', 40, { utilityType: 'water', sourceType: 'municipal' }),
      meter('bh', 'source_supply', 25, { utilityType: 'water', sourceType: 'borehole' }),
      // borehole → tank → building: these are internal movements, must not be added again
      meter('tank-in', 'tank_inflow', 25, { utilityType: 'water' }),
      meter('tank-out', 'tank_outflow', 22, { utilityType: 'water' }),
      meter('main', 'consumption', 66, { utilityType: 'water' }),
    ];
    const b = waterBalance(meters, sources, [{ sourceId: 'Tank 10kL', startLitres: 4000, endLitres: 7000 }], [{ sourceId: 'Tanker', kl: 5 }]);
    expect(b.bySource.map((s) => [s.sourceType, s.volume])).toEqual([
      ['municipal', { value: 40, basis: 'measured' }],
      ['borehole', { value: 25, basis: 'measured' }],
      ['tanker', { value: 5, basis: 'logged' }],
    ]);
    expect(b.totalSupply).toEqual({ value: 70, basis: 'derived' }); // logged tanker makes it derived
    expect(b.storageChange.value).toBe(3); // +3 kL stored
    expect(b.siteUse.value).toBe(67);
    expect(b.variance.value).toBe(1);
    expect(b.internalTransfers.value).toBe(47);
    expect(b.notes.join(' ')).toMatch(/never used for billing/);
  });

  it('reports unknown tank levels as a gap and does not invent site use', () => {
    const b = waterBalance([meter('muni', 'source_supply', 40, { utilityType: 'water', sourceType: 'municipal' })], sources, [], []);
    expect(b.storageChange.basis).toBe('missing');
    expect(b.siteUse.value).toBeNull();
    expect(b.gaps.map((g) => g.kind)).toEqual(expect.arrayContaining(['tank_level_unknown', 'source_not_metered']));
  });
});
