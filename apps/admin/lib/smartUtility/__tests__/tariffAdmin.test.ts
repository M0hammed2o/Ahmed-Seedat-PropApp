import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { parseCsv, parseTariffCsv, tariffProblem } = await import('../tariffAdmin');

// Spreadsheet tariff import: a municipality's published schedule typed into a sheet and saved as CSV.

const HEADER = 'utility_type,name,tariff_kind,effective_from,fixed_charge,blocks,vat_inclusive,vat_rate,unit_label,municipality_code,customer_class,source_reference';

describe('CSV parsing', () => {
  it('handles quotes, escaped quotes, commas inside quotes and CRLF', () => {
    expect(parseCsv('a,"b,c","say ""hi"""\r\n1,2,3\r\n\r\n')).toEqual([
      ['a', 'b,c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });
});

describe('tariff CSV import', () => {
  const units = new Map([['flat 1', '1a2b3c4d-0000-4000-8000-000000000001']]);

  it('parses block, flat and unit-specific rows with decimal commas', () => {
    const csv = [
      HEADER,
      'water,Domestic water 2026/27,block,2026-07-01,0,"6:25.10;15:32.50;*:45.00",yes,15,,ethekwini,domestic,Tariff book p.12',
      'electricity,Unit 1 recharge,flat,2026-07-01,"150,00",*:3.10,yes,15,Flat 1,,,',
    ].join('\n');
    const { rows, headerError } = parseTariffCsv(csv, units);
    expect(headerError).toBeUndefined();
    expect(rows.map((r) => [r.ok, r.errors])).toEqual([
      [true, []],
      [true, []],
    ]);
    expect(rows[0]!.tariff).toMatchObject({
      utilityType: 'water',
      tariffKind: 'block',
      blocks: [{ upTo: 6, rate: 25.1 }, { upTo: 15, rate: 32.5 }, { upTo: null, rate: 45 }],
      vatInclusive: true,
      municipalityCode: 'ethekwini',
    });
    expect(rows[1]!.tariff).toMatchObject({ tariffKind: 'flat', fixedCharge: 150, unitId: '1a2b3c4d-0000-4000-8000-000000000001' });
  });

  it('reports every bad row with its line number and never guesses', () => {
    const csv = [
      HEADER,
      'water,Bad order,block,2026-07-01,0,"15:30;6:20;*:40",yes,15,,,,', // blocks not ascending
      'gas,Wrong utility,block,2026-07-01,0,*:1,yes,15,,,,',
      'water,Unknown unit,block,2026-07-01,0,*:1,yes,15,Flat 9,,,',
      'electricity,Peak,tou,2026-07-01,0,*:1,yes,15,,,,',
      'water,Bad block,block,2026-07-01,0,6-25,yes,15,,,,',
    ].join('\n');
    const { rows } = parseTariffCsv(csv, units);
    expect(rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 6]);
    expect(rows.every((r) => !r.ok)).toBe(true);
    expect(rows[2]!.errors).toContain('Unknown unit "Flat 9".');
    expect(rows[3]!.errors.join(' ')).toMatch(/entered in the form/);
    expect(rows[4]!.errors.join(' ')).toMatch(/upTo:rate/);
  });

  it('requires the essential columns', () => {
    expect(parseTariffCsv('name,rate\nx,1', units).headerError).toMatch(/utility_type, effective_from, blocks/);
  });
});

describe('tariff completeness', () => {
  const base = {
    utilityType: 'electricity' as const,
    name: 't',
    tariffKind: 'block' as const,
    fixedCharge: 0,
    blocks: [],
    touPeriods: [],
    seasons: [],
    vatInclusive: true,
    vatRate: 15,
    prorateBlocks: true,
    effectiveFrom: '2026-07-01',
  };
  it('rejects rate-based tariffs without rates and flat tariffs with several rates', () => {
    expect(tariffProblem(base)).toMatch(/rate block/);
    expect(tariffProblem({ ...base, tariffKind: 'tou' })).toMatch(/time-of-use/);
    expect(tariffProblem({ ...base, tariffKind: 'flat', blocks: [{ upTo: 10, rate: 1 }, { upTo: null, rate: 2 }] })).toMatch(/exactly one/);
    expect(tariffProblem({ ...base, tariffKind: 'fixed_only', fixedCharge: 300 })).toBeNull();
  });
});
