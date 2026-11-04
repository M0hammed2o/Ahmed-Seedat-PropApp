import { describe, expect, it } from 'vitest';
import { offlineAlertTitle } from '../jobs';

const base = {
  meter_number: null,
  serial_number: null,
  utility_type: 'electricity',
  meter_role: 'check',
  measurement_kind: 'consumption',
};

describe('offlineAlertTitle', () => {
  it('names the meter by its number, then its serial number', () => {
    expect(offlineAlertTitle({ ...base, meter_number: 'DEMO-E-101', serial_number: 'S1' })).toBe(
      'Meter DEMO-E-101 is offline',
    );
    expect(offlineAlertTitle({ ...base, serial_number: 'SN-778' })).toBe('Meter SN-778 is offline');
  });

  it('without a number, identifies the meter by unit, role, utility and register', () => {
    expect(
      offlineAlertTitle({ ...base, utility_type: 'water', meter_role: 'submeter' }, 'Unit 4'),
    ).toBe('Unit 4 water meter is offline');
    expect(offlineAlertTitle({ ...base, measurement_kind: 'battery_charge' })).toBe(
      'Check electricity meter (battery charge) is offline',
    );
    expect(offlineAlertTitle({ ...base, meter_role: 'main', meter_number: '  ' })).toBe(
      'Main electricity meter is offline',
    );
  });

  it('never produces the bare "Meter is offline"', () => {
    for (const role of ['main', 'check', 'submeter', null])
      for (const kind of ['consumption', 'generation', null])
        expect(
          offlineAlertTitle({ ...base, meter_role: role, measurement_kind: kind }),
        ).not.toMatch(/^Meter\s+is offline$/);
  });
});
