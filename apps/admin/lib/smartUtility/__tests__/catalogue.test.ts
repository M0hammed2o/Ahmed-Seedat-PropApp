import { describe, expect, it } from 'vitest';
import { METER_CATALOGUE } from '../meterCatalogue';
import { PROVIDERS } from '../providers';

// The catalogue is customer-facing: these tests stop it from overstating compatibility.
describe('meter catalogue honesty', () => {
  it('only marks hardware-free paths (manual, Proplyst JSON) as verified and ready', () => {
    const ready = METER_CATALOGUE.filter((e) => e.status === 'verified_ready');
    expect(ready.length).toBeGreaterThan(0);
    for (const e of ready) {
      expect(e.manufacturer).toBe('Any');
      expect(e.providers.every((p) => PROVIDERS[p].verification === 'verified')).toBe(true);
    }
  });

  it('never offers an integration path for supplier-gated or unsupported entries', () => {
    for (const e of METER_CATALOGUE.filter((x) => x.status === 'supplier_approval' || x.status === 'unsupported')) {
      expect(e.providers).toEqual([]);
      expect(e.caveats.length).toBeGreaterThan(0);
    }
  });

  it('cites a supplier URL and date for every price, and uses known providers', () => {
    for (const e of METER_CATALOGUE) {
      if (e.price) {
        expect(e.price.url).toMatch(/^https:\/\//);
        expect(e.price.seenOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(e.price.amountZar).toBeGreaterThan(0);
      }
      for (const p of e.providers) expect(PROVIDERS[p]).toBeDefined();
      if (e.status === 'needs_hardware_testing') expect(e.providers.length).toBeGreaterThan(0);
    }
  });

  it('flags every monitoring-grade (non-billing) hardware entry with a caveat', () => {
    // Selectable hardware only; supplier-gated/unsupported entries are covered by the caveat rule above.
    for (const e of METER_CATALOGUE.filter((x) => !x.billingGrade && x.manufacturer !== 'Any' && x.status === 'needs_hardware_testing')) {
      expect(e.caveats.join(' ')).toMatch(/monitoring|Not a SANS|billing/i);
    }
  });

  it('has unique ids and covers water and electricity for every meter role', () => {
    expect(new Set(METER_CATALOGUE.map((e) => e.id)).size).toBe(METER_CATALOGUE.length);
    for (const u of ['water', 'electricity'] as const) {
      for (const role of ['main', 'check', 'submeter'] as const) {
        expect(METER_CATALOGUE.some((e) => e.utilityType === u && e.roles.includes(role) && e.status !== 'unsupported')).toBe(true);
      }
    }
  });
});
