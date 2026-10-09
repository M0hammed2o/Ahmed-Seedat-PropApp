import 'server-only';
import PDFDocument from 'pdfkit';
import { computeIntervals, sastDateString, type MeterReadingPoint } from './consumption';
import { DEFAULT_INCLUDE_FIELDS, readingLines, type IncludeFields } from './templates';

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
  /** not_required (device) · unverified · verified (reviewed by a person). */
  verificationStatus?: 'not_required' | 'unverified' | 'verified' | 'rejected';
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

  const reviewed = current.verificationStatus === 'verified';
  const note =
    verification === 'photo_verified'
      ? reviewed
        ? 'Read from the municipal meter; photo evidence on file and reviewed.'
        : 'Read from the municipal meter; photo evidence on file (not yet reviewed).'
      : verification === 'manual_unverified' && reviewed
        ? 'Entered by hand and reviewed (no photo).'
        : VERIFICATION_NOTE[verification];
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
    verificationNote: note,
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

export function reportPdfFilename(r: MunicipalReport): string {
  return `meter-readings-${r.period.end}.pdf`;
}

export function reportCsvFilename(r: MunicipalReport): string {
  return `meter-readings-${r.period.end}.csv`;
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

export interface PdfImage {
  meterId: string;
  buffer: Buffer;
  caption: string;
}

/**
 * The pack's PDF. `fields` mirrors the template toggles (default: everything); `images` are meter
 * photos (JPEG/PNG bytes already loaded through the protected-storage ownership check).
 */
export function renderReportPdf(
  r: MunicipalReport,
  opts: { fields?: IncludeFields; images?: PdfImage[] } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const f = opts.fields ?? DEFAULT_INCLUDE_FIELDS;
    doc.fontSize(16).fillColor('#111111').text('Meter reading submission');
    doc.moveDown(0.5).fontSize(10);
    doc.text(`Property: ${r.property.name}${f.propertyAddress ? `, ${r.property.address}` : ''}`);
    if (r.preparedFor) doc.text(`Owner / managing agent: ${r.preparedFor}`);
    if (r.municipality) doc.text(`Municipality: ${r.municipality.name}`);
    if (r.municipalAccountNumber && f.accountNumber) doc.text(`Municipal account number: ${r.municipalAccountNumber}`);
    doc.text(`Reporting period: ${r.period.start} to ${r.period.end}`);
    doc.moveDown();
    for (const m of r.meters) {
      for (const l of readingLines(m, f)) doc.text(l);
      const imgs = (opts.images ?? []).filter((i) => i.meterId === m.meterId);
      for (const img of imgs) {
        try {
          doc.moveDown(0.3);
          if (doc.y + 200 > doc.page.height - doc.page.margins.bottom) doc.addPage();
          const imgTop = doc.y;
          doc.image(img.buffer, doc.page.margins.left, imgTop, { fit: [240, 180] });
          doc.y = imgTop + 186; // below the fitted image box, so the caption never overlaps it
          doc.fontSize(8).fillColor('#555555').text(img.caption, doc.page.margins.left).fontSize(10).fillColor('#111111');
        } catch {
          doc.fontSize(8).fillColor('#555555').text('(photo could not be embedded)').fontSize(10).fillColor('#111111');
        }
      }
      doc.moveDown();
    }
    for (const n of r.notes) doc.text(`Note: ${n}`);
    doc.moveDown().fontSize(8).fillColor('#555555').text(
      `Generated ${fmtDate(r.generatedAt)} by Proplyst. A sent submission is not confirmation that the municipality accepted the reading.`,
    );
    doc.end();
  });
}

export interface EvidenceReportInput {
  propertyName: string;
  propertyAddress: string;
  meterLabel: string;
  meterNumber: string | null;
  serialNumber: string | null;
  utilityType: 'water' | 'electricity';
  reading: number;
  unit: string;
  readAt: string;
  submittedBy: string | null;
  source: string;
  verificationStatus: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  note: string | null;
  image: Buffer | null;
  imageCaption: string;
}

/** One-page meter evidence report: the photo alongside the reading and who recorded/verified it. */
export function renderEvidencePdf(e: EvidenceReportInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).fillColor('#111111').text('Meter reading evidence');
    doc.fontSize(10).fillColor('#555555').text(`${e.propertyName}, ${e.propertyAddress}`);
    doc.moveDown();
    const top = doc.y;
    if (e.image) {
      try {
        doc.image(e.image, 50, top, { fit: [250, 300] });
      } catch {
        doc.fillColor('#555555').text('(photo could not be embedded)', 50, top);
      }
    } else {
      doc.rect(50, top, 250, 200).stroke('#cccccc');
      doc.fillColor('#777777').text('No photo provided', 60, top + 90);
    }
    doc.fontSize(8).fillColor('#555555').text(e.imageCaption, 50, top + 305, { width: 250 });
    const rows: [string, string][] = [
      ['Meter', e.meterLabel],
      ['Meter number', e.meterNumber ?? '—'],
      ['Serial number', e.serialNumber ?? '—'],
      ['Utility', e.utilityType === 'water' ? 'Water' : 'Electricity'],
      ['Reading', `${e.reading.toLocaleString('en-ZA', { maximumFractionDigits: 3 })} ${e.unit}`],
      ['Reading date', fmtDate(e.readAt)],
      ['Recorded by', e.submittedBy ?? '—'],
      ['Source', e.source],
      ['Verification', e.verificationStatus.replace('_', ' ')],
      ['Verified by', e.verifiedBy ? `${e.verifiedBy}${e.verifiedAt ? ` on ${fmtDate(e.verifiedAt)}` : ''}` : '—'],
      ['Note', e.note ?? '—'],
    ];
    let y = top;
    for (const [k, v] of rows) {
      doc.fontSize(9).fillColor('#555555').text(k, 320, y, { width: 90 });
      doc.fontSize(10).fillColor('#111111').text(v, 410, y, { width: 135 });
      // Measure the wrapped value so a long value never overlaps the next row.
      y += Math.max(22, doc.heightOfString(v, { width: 135 }) + 8);
    }
    doc.fontSize(8).fillColor('#555555').text(
      'Readings entered by a person are shown as unverified until reviewed. Proplyst does not treat photo-based or automated readings as verified without a reviewer.',
      50, top + 340, { width: 495 },
    );
    doc.end();
  });
}
