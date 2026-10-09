import { afterEach, describe, expect, it } from 'vitest';
import { buildMunicipalReport, renderReportCsv, renderReportPdf, reportTextLines, type ReportPoint } from '../municipalReport';
import { duePeriod, effectiveMode, nextRetryAt, rollupStatus, MAX_DELIVERY_ATTEMPTS } from '../submissions';
import { sastDateString, sastInstant } from '../consumption';
import { MUNICIPALITIES } from '../catalog';
import { renderEmailTemplate } from '../../emailDispatch';

function p(iso: string, value: number, extra: Partial<ReportPoint> = {}): ReportPoint {
  return { readAt: iso, rawValue: value, value, multiplier: 1, status: 'valid', source: 'manual', documentId: null, ...extra };
}

const periodStart = sastInstant(2026, 9, 25);
const periodEnd = sastInstant(2026, 10, 25);

function build(points: ReportPoint[], registerDigits: number | null = null) {
  return buildMunicipalReport({
    propertyName: 'Block A',
    propertyAddress: '1 Meter St, Durban',
    preparedFor: 'Acme Properties',
    municipality: { code: 'tshwane', name: 'City of Tshwane' },
    municipalAccountNumber: '5001234567',
    periodStart,
    periodEnd,
    meters: [{ meterId: 'm1', utilityType: 'water', meterNumber: 'W-123', serialNumber: 'SN9', registerDigits, points }],
    now: new Date('2026-10-21T08:00:00Z'),
  });
}

describe('municipal report snapshot', () => {
  it('uses the reading at/before period start as previous and the latest in-period reading as current, in kL', () => {
    const r = build([
      p('2026-09-20T10:00:00Z', 1_000_000),
      p('2026-09-24T10:00:00Z', 1_010_000, { documentId: 'doc-prev' }),
      p('2026-10-20T10:00:00Z', 1_035_500, { documentId: 'doc-curr' }),
      p('2026-10-26T10:00:00Z', 1_040_000), // after period end: ignored
    ]);
    const m = r.meters[0]!;
    expect(m.previousReading).toBe(1010);
    expect(m.currentReading).toBe(1035.5);
    expect(m.consumption).toBe(25.5);
    expect(m.verification).toBe('photo_verified');
    expect(m.evidenceDocumentIds).toEqual(['doc-curr']);
    expect(r.period).toEqual({ start: '2026-09-25', end: '2026-10-24' });
  });

  it('labels device-derived readings and asks for dial verification', () => {
    const r = build([p('2026-09-24T10:00:00Z', 1000, { source: 'device' }), p('2026-10-20T10:00:00Z', 3000, { source: 'device' })]);
    expect(r.meters[0]!.verification).toBe('device_derived');
    expect(r.notes.join(' ')).toMatch(/checked against the meter dial/);
  });

  it('never invents a reading: a meter with no in-period reading is "missing"', () => {
    const r = build([p('2026-09-24T10:00:00Z', 1000)]);
    expect(r.meters[0]).toMatchObject({ verification: 'missing', currentReading: null, consumption: null });
    expect(r.notes.join(' ')).toMatch(/no reading/);
  });

  it('leaves consumption blank across a meter reset', () => {
    const r = build([p('2026-09-24T10:00:00Z', 900_000), p('2026-10-20T10:00:00Z', 5_000)]);
    expect(r.meters[0]!.consumption).toBeNull();
    expect(r.notes.join(' ')).toMatch(/reset or replacement/);
  });

  it('handles a register rollover between submissions', () => {
    const r = build([p('2026-09-24T10:00:00Z', 99_990), p('2026-10-20T10:00:00Z', 40)], 5);
    expect(r.meters[0]!.consumption).toBe(0.05); // 50 L
  });

  it('renders CSV with formula-injection protection and the PDF as a real PDF', async () => {
    const r = build([p('2026-09-24T10:00:00Z', 1000), p('2026-10-20T10:00:00Z', 2000)]);
    r.property.name = '=HYPERLINK("http://evil")';
    const csv = renderReportCsv(r);
    expect(csv.split('\r\n')[0]).toContain('municipal_account_number');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    const pdf = await renderReportPdf(r);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders the email template with the reading lines and no tenant data', () => {
    const r = build([p('2026-09-24T10:00:00Z', 1000), p('2026-10-20T10:00:00Z', 2000)]);
    const email = renderEmailTemplate(
      'municipal_meter_reading_report',
      { subject: 'Meter readings', heading: 'Meter readings', textLines: reportTextLines(r), preparedFor: 'Acme Properties' },
      'https://app.example',
    );
    expect(email.bodyText).toContain('Municipal account number: 5001234567');
    expect(email.bodyText).toContain('Current reading: 2 kL');
    expect(email.bodyHtml).toContain('Acme Properties');
  });
});

describe('submission state helpers', () => {
  const original = process.env.SMART_UTILITY_AUTO_SUBMISSION_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.SMART_UTILITY_AUTO_SUBMISSION_ENABLED;
    else process.env.SMART_UTILITY_AUTO_SUBMISSION_ENABLED = original;
  });

  it('degrades automatic to approval-required while the platform flag is off', () => {
    delete process.env.SMART_UTILITY_AUTO_SUBMISSION_ENABLED;
    expect(effectiveMode('automatic')).toBe('approval_required');
    process.env.SMART_UTILITY_AUTO_SUBMISSION_ENABLED = 'true';
    expect(effectiveMode('automatic')).toBe('automatic');
    expect(effectiveMode('manual')).toBe('manual');
  });

  it('backs off 1 h, 6 h, 24 h, then gives up', () => {
    const now = new Date('2026-10-08T00:00:00Z');
    expect(nextRetryAt(1, now)?.toISOString()).toBe('2026-10-08T01:00:00.000Z');
    expect(nextRetryAt(2, now)?.toISOString()).toBe('2026-10-08T06:00:00.000Z');
    expect(nextRetryAt(3, now)?.toISOString()).toBe('2026-10-09T00:00:00.000Z');
    expect(nextRetryAt(MAX_DELIVERY_ATTEMPTS, now)).toBeNull();
  });

  it('rolls delivery outcomes up without treating "sent" as "accepted"', () => {
    expect(rollupStatus(['sent', 'delivered'], [true, true])).toBe('sent');
    expect(rollupStatus(['sent', 'failed'], [true, true])).toBe('sending'); // retry pending
    expect(rollupStatus(['sent', 'failed'], [true, false])).toBe('partially_failed');
    expect(rollupStatus(['bounced'], [true])).toBe('failed');
  });

  it('prepares a pack lead_days before the billing day, for the period ending on it', () => {
    const due = duePeriod(new Date('2026-10-21T06:00:00Z'), 25, 5);
    expect(due && sastDateString(due.start)).toBe('2026-09-25');
    expect(due && sastDateString(due.end)).toBe('2026-10-25');
    expect(duePeriod(new Date('2026-10-10T06:00:00Z'), 25, 5)).toBeNull();
    expect(duePeriod(new Date('2026-10-19T06:00:00Z'), 25, 5)).toBeNull();
  });
});

describe('municipality directory', () => {
  it('only marks email submission where a verified address exists, and every entry cites a source', () => {
    for (const m of MUNICIPALITIES) {
      const hasEmail = m.channels.some((c) => c.kind === 'email');
      expect(m.emailSubmission).toBe(hasEmail);
      if (m.code !== 'other') expect(m.sourceUrl).toMatch(/^https?:\/\//);
    }
    // Ambiguous / stale addresses are deliberately not pre-filled.
    const all = JSON.stringify(MUNICIPALITIES.flatMap((m) => m.channels));
    expect(all).not.toContain('revlineresponse@durban.gov.za');
    expect(all).not.toContain('africanmet.co.za');
  });
});
