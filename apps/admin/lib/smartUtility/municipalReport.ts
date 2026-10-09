import 'server-only';
import PDFDocument from 'pdfkit';
import { computeIntervals, sastDateString, type MeterReadingPoint } from './consumption';

// Monthly municipal meter-reading pack (docs/SMART_UTILITY_ARCHITECTURE.md §8). Building the snapshot
// is pure (unit-tested); rendering produces email text, CSV and PDF from the SAME snapshot, so what
// is stored in municipal_submissions.report is exactly what was sent.
//
// Only OFFICIAL (ownership = 'municipal') meters belong in a pack. Private submeter readings are
// never submitted to a municipality.

export type ReadingVerification = 'photo_verified' | 'device_derived' | 'manual_unverified' | 'missing';

export interface ReportMeterLine {
  meterId: string;
  utilityType: 'water' | 'electricity';
  meterNumber: string | null;
  serialNumber: string | null;
  unit: 'kL' | 'kWh';
  previousReading: number | null;
  previousReadingAt: string | null;
  currentReading: number | null;
  currentReadingAt: string | null;
  consumption: number | null;
  verification: ReadingVerification;
  verificationNote: string;
  evidenceDocumentIds: string[];
}

export interface MunicipalReport {
  version: 1;
  generatedAt: string;
  property: { name: string; address: string };
  preparedFor: string | null;
  municipality: { code: string; name: string } | null;
  municipalAccountNumber: string | null;
  period: { start: string; end: string };
  meters: ReportMeterLine[];
  notes: string[];
}

export interface ReportPoint extends MeterReadingPoint {
  source: 'device' | 'manual' | 'simulator' | 'estimated';
  documentId: string | null;
}

export interface ReportMeterInput {
  meterId: string;
  utilityType: 'water' | 'electricity';
  meterNumber: string | null;
  serialNumber: string | null;
  registerDigits: number | null;
  points: ReportPoint[];
}

const VERIFICATION_NOTE: Record<ReadingVerification, string> = {
  photo_verified: 'Read from the municipal meter; photo evidence on file.',
  device_derived:
    'From a counter fitted to the municipal meter. Verify against the meter dial before relying on it.',
  manual_unverified: 'Entered by hand without a photo.',
  missing: 'No reading available for this period.',
};

function toDisplay(utilityType: 'water' | 'electricity', base: number): number {
  // Water is stored in litres; municipal water meters display kilolitres.
  const v = utilityType === 'water' ? base / 1000 : base;
  return Math.round(v * 1000) / 1000;
}

/**
 * Picks the current reading (latest valid reading at or before period end) and the previous one
 * (latest valid reading at or before period start), and the consumption between them via the
 * rollover/reset-aware interval engine. A reset between the two leaves consumption null.
 */
export function buildMeterLine(input: ReportMeterInput, periodStart: Date, periodEnd: Date): ReportMeterLine {
  const valid = input.points
    .filter((p) => (p.status ?? 'valid') === 'valid')
    .map((p) => ({ ...p, at: new Date(p.readAt) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const unit = input.utilityType === 'water' ? 'kL' : 'kWh';
  const current = [...valid].reverse().find((p) => p.at.getTime() <= periodEnd.getTime() && p.at >= periodStart);
  const previous = [...valid].reverse().find((p) => p.at.getTime() <= periodStart.getTime());

  if (!current) {
    return {
      meterId: input.meterId,
      utilityType: input.utilityType,
      meterNumber: input.meterNumber,
      serialNumber: input.serialNumber,
      unit,
      previousReading: previous ? toDisplay(input.utilityType, previous.value) : null,
      previousReadingAt: previous ? previous.at.toISOString() : null,
      currentReading: null,
      currentReadingAt: null,
      consumption: null,
      verification: 'missing',
      verificationNote: VERIFICATION_NOTE.missing,
      evidenceDocumentIds: [],
    };
  }

  let consumption: number | null = null;
  if (previous) {
    const between = valid.filter((p) => p.at >= previous.at && p.at <= current.at);
    const intervals = computeIntervals(between, { registerDigits: input.registerDigits });
    consumption = intervals.some((iv) => iv.consumption === null)
      ? null
      : toDisplay(
          input.utilityType,
          intervals.reduce((s, iv) => s + (iv.consumption ?? 0), 0),
        );
  }

  const verification: ReadingVerification = current.documentId
    ? 'photo_verified'
    : current.source === 'device' || current.source === 'simulator'
      ? 'device_derived'
      : 'manual_unverified';

  return {
    meterId: input.meterId,
    utilityType: input.utilityType,
    meterNumber: input.meterNumber,
    serialNumber: input.serialNumber,
    unit,
    previousReading: previous ? toDisplay(input.utilityType, previous.value) : null,
    previousReadingAt: previous ? previous.at.toISOString() : null,
    currentReading: toDisplay(input.utilityType, current.value),
    currentReadingAt: current.at.toISOString(),
    consumption,
    verification,
    verificationNote: VERIFICATION_NOTE[verification],
    evidenceDocumentIds: current.documentId ? [current.documentId] : [],
  };
}

export function buildMunicipalReport(args: {
  propertyName: string;
  propertyAddress: string;
  preparedFor: string | null;
  municipality: { code: string; name: string } | null;
  municipalAccountNumber: string | null;
  periodStart: Date;
  periodEnd: Date;
  meters: ReportMeterInput[];
  now?: Date;
}): MunicipalReport {
  const lines = args.meters.map((m) => buildMeterLine(m, args.periodStart, args.periodEnd));
  const notes: string[] = [];
  if (lines.some((l) => l.verification === 'missing')) {
    notes.push('One or more meters have no reading for this period.');
  }
  if (lines.some((l) => l.verification === 'device_derived')) {
    notes.push('Device-derived readings should be checked against the meter dial.');
  }
  if (lines.some((l) => l.currentReading !== null && l.consumption === null && l.previousReading !== null)) {
    notes.push('A meter reset or replacement was detected; consumption for that meter is not calculated.');
  }
  return {
    version: 1,
    generatedAt: (args.now ?? new Date()).toISOString(),
    property: { name: args.propertyName, address: args.propertyAddress },
    preparedFor: args.preparedFor,
    municipality: args.municipality,
    municipalAccountNumber: args.municipalAccountNumber,
    // Period end is exclusive at 00:00 SAST; show the last included calendar day.
    period: {
      start: sastDateString(args.periodStart),
      end: sastDateString(new Date(args.periodEnd.getTime() - 1)),
    },
    meters: lines,
    notes,
  };
}

// ---------------------------------------------------------------- rendering

function fmtDate(iso: string | null): string {
  return iso ? sastDateString(new Date(iso)) : '—';
}

function fmtNum(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('en-ZA', { maximumFractionDigits: 3 });
}

export function reportSubject(r: MunicipalReport): string {
  const acct = r.municipalAccountNumber ? ` — account ${r.municipalAccountNumber}` : '';
  return `Meter readings for ${r.property.address}${acct} (${r.period.end})`;
}

export function reportTextLines(r: MunicipalReport): string[] {
  const lines = [
    `Property: ${r.property.name}, ${r.property.address}`,
    r.preparedFor ? `Owner / managing agent: ${r.preparedFor}` : null,
    r.municipality ? `Municipality: ${r.municipality.name}` : null,
    r.municipalAccountNumber ? `Municipal account number: ${r.municipalAccountNumber}` : null,
    `Reporting period: ${r.period.start} to ${r.period.end}`,
    '',
  ].filter((l): l is string => l !== null);
  for (const m of r.meters) {
    lines.push(
      `${m.utilityType === 'water' ? 'Water' : 'Electricity'} meter ${m.meterNumber ?? m.serialNumber ?? m.meterId}` +
        (m.serialNumber && m.meterNumber ? ` (serial ${m.serialNumber})` : ''),
      `  Previous reading: ${fmtNum(m.previousReading)} ${m.unit} on ${fmtDate(m.previousReadingAt)}`,
      `  Current reading: ${fmtNum(m.currentReading)} ${m.unit} on ${fmtDate(m.currentReadingAt)}`,
      `  Consumption: ${fmtNum(m.consumption)} ${m.unit}`,
      `  Source: ${m.verificationNote}`,
      '',
    );
  }
  for (const n of r.notes) lines.push(`Note: ${n}`);
  return lines;
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection as well as quoting.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function renderReportCsv(r: MunicipalReport): string {
  const header = [
    'property', 'address', 'municipality', 'municipal_account_number', 'period_start', 'period_end',
    'utility', 'meter_number', 'serial_number', 'unit', 'previous_reading', 'previous_reading_date',
    'current_reading', 'current_reading_date', 'consumption', 'verification',
  ];
  const rows = r.meters.map((m) => [
    r.property.name, r.property.address, r.municipality?.name ?? '', r.municipalAccountNumber ?? '',
    r.period.start, r.period.end, m.utilityType, m.meterNumber ?? '', m.serialNumber ?? '', m.unit,
    m.previousReading ?? '', m.previousReadingAt ? fmtDate(m.previousReadingAt) : '',
    m.currentReading ?? '', m.currentReadingAt ? fmtDate(m.currentReadingAt) : '',
    m.consumption ?? '', m.verification,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function renderReportPdf(r: MunicipalReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text('Meter reading submission', { underline: false });
    doc.moveDown(0.5).fontSize(10);
    for (const line of reportTextLines(r)) doc.text(line);
    doc.moveDown().fontSize(8).fillColor('#555555').text(
      `Generated ${fmtDate(r.generatedAt)} by Proplyst. A sent submission is not confirmation that the municipality accepted the reading.`,
    );
    doc.end();
  });
}
