import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { evaluateDaily, evaluateLevel, evaluateRunHours, levelPct, median } = await import('../hybridAlerts');

const tank = { id: 't', name: 'JoJo 5 000 L', source_type: 'storage_tank', utility_type: 'water' as const, low_level_pct: 20, high_level_pct: 98, capacity_value: 5000, capacity_unit: 'litres' };

describe('level rules', () => {
  it('converts litres to % only when the capacity is in litres', () => {
    expect(levelPct(tank, 'tank_level_litres', 1000)).toBe(20);
    expect(levelPct({ ...tank, capacity_unit: null }, 'tank_level_litres', 1000)).toBeNull();
  });
  it('raises tank low (critical at half the threshold) and overflow, nothing in between', () => {
    expect(evaluateLevel(tank, 'tank_level_pct', 18)).toMatchObject({ rule: 'tank_low', severity: 'warning' });
    expect(evaluateLevel(tank, 'tank_level_litres', 400)).toMatchObject({ rule: 'tank_low', severity: 'critical' }); // 8 %
    expect(evaluateLevel(tank, 'tank_level_pct', 99)).toMatchObject({ rule: 'tank_overflow' });
    expect(evaluateLevel(tank, 'tank_level_pct', 60)).toBeNull();
  });
  it('flags a low battery and low generator fuel, but not a battery on a tank metric', () => {
    expect(evaluateLevel({ ...tank, source_type: 'battery', utility_type: 'electricity' }, 'battery_soc_pct', 15)).toMatchObject({ rule: 'battery_issue' });
    expect(evaluateLevel({ ...tank, source_type: 'generator', utility_type: 'electricity' }, 'fuel_level_pct', 10)).toMatchObject({ rule: 'generator_abnormal' });
    expect(evaluateLevel({ ...tank, source_type: 'battery', utility_type: 'electricity' }, 'tank_level_pct', 10)).toBeNull();
  });
});

describe('daily ratio rules', () => {
  const sunnyWeek = [22, 24, 21, 23, 25, 20, 22, 24, 23, 21, 22, 25, 24, 23];
  it('needs at least 5 days of history', () => {
    expect(median([1, 2, 3, 4])).toBeNull();
    expect(evaluateDaily('generation', 0, [20, 20, 20])).toBeNull();
  });
  it('flags solar below a quarter of its median, not an ordinary cloudy day', () => {
    expect(evaluateDaily('generation', 4, sunnyWeek)).toMatchObject({ rule: 'solar_issue' });
    expect(evaluateDaily('generation', 9, sunnyWeek)).toBeNull();
    expect(evaluateDaily('generation', null, sunnyWeek)).toBeNull(); // missing data is not "zero output"
  });
  it('flags a borehole pump running far above normal', () => {
    expect(evaluateDaily('pump_energy', 30, [8, 9, 10, 8, 9, 11, 10])).toMatchObject({ rule: 'pump_abnormal' });
    expect(evaluateDaily('pump_energy', 15, [8, 9, 10, 8, 9, 11, 10])).toBeNull();
  });
  it('flags generator run hours well above expected', () => {
    expect(evaluateRunHours(7, 4)).toBe(true);
    expect(evaluateRunHours(5, 4)).toBe(false);
    expect(evaluateRunHours(7, null)).toBe(false);
  });
});
