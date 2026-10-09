// Municipal email templates (docs/SMART_UTILITIES_DECISIONS.md #5). Pure: placeholder rendering,
// field toggles and the approval hash. The hash covers EVERYTHING that determines what is sent
// (template text, field toggles, custom message, account holder, CC list and the authorised
// recipients) so any change invalidates the owner's approval.
import crypto from 'node:crypto';
import type { MunicipalReport, ReportMeterLine } from './municipalReport';

export interface IncludeFields {
  propertyAddress: boolean;
  accountNumber: boolean;
  accountHolder: boolean;
  serialNumber: boolean;
  previousReading: boolean;
  consumption: boolean;
  readingDate: boolean;
  photos: boolean;
}

export const DEFAULT_INCLUDE_FIELDS: IncludeFields = {
  propertyAddress: true,
  accountNumber: true,
  accountHolder: true,
  serialNumber: true,
  previousReading: true,
  consumption: true,
  readingDate: true,
  photos: true,
};

export const DEFAULT_SUBJECT = 'Meter readings for {{property_address}} — account {{account_number}} ({{period_end}})';

export const DEFAULT_BODY = `Good day,

Please find the meter readings for the property below for the period {{period_start}} to {{period_end}}. A PDF report is attached.

{{readings}}

{{custom_message}}

Kind regards,
{{sender}}`;

export const PLACEHOLDERS = [
  'property_name',
  'property_address',
  'account_number',
  'account_holder',
  'municipality',
  'period_start',
  'period_end',
  'readings',
  'custom_message',
  'sender',
] as const;

export function normaliseFields(raw: unknown): IncludeFields {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof IncludeFields, unknown>>;
  const out = { ...DEFAULT_INCLUDE_FIELDS };
  for (const k of Object.keys(out) as (keyof IncludeFields)[]) {
    if (typeof src[k] === 'boolean') out[k] = src[k] as boolean;
  }
  return out;
}

export interface TemplateSettings {
  subjectTemplate: string | null;
  bodyTemplate: string | null;
  includeFields: IncludeFields;
  customMessage: string | null;
  accountHolderName: string | null;
  ccEmails: string[];
  /** Emails of active, authorised recipients. */
  recipients: string[];
}

export function templateHash(t: TemplateSettings): string {
  const canonical = JSON.stringify({
    s: (t.subjectTemplate ?? DEFAULT_SUBJECT).trim(),
    b: (t.bodyTemplate ?? DEFAULT_BODY).replace(/\r\n/g, '\n').trim(),
    f: t.includeFields,
    m: (t.customMessage ?? '').trim(),
    a: (t.accountHolderName ?? '').trim(),
    cc: [...t.ccEmails].map((e) => e.toLowerCase()).sort(),
    to: [...t.recipients].map((e) => e.toLowerCase()).sort(),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function fmt(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('en-ZA', { maximumFractionDigits: 3 });
}

function dateOnly(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 2 * 3_600_000); // SAST
  return d.toISOString().slice(0, 10);
}

/** One block of lines per meter, honouring the field toggles. */
export function readingLines(m: ReportMeterLine, f: IncludeFields): string[] {
  const kind = m.utilityType === 'water' ? 'Water' : 'Electricity';
  const ident = m.meterNumber ?? m.serialNumber ?? m.meterId.slice(0, 8);
  const lines = [
    `${kind} meter ${ident}${f.serialNumber && m.serialNumber && m.meterNumber ? ` (serial ${m.serialNumber})` : ''}`,
  ];
  if (f.previousReading) {
    lines.push(`  Previous reading: ${fmt(m.previousReading)} ${m.unit}${f.readingDate ? ` on ${dateOnly(m.previousReadingAt)}` : ''}`);
  }
  lines.push(`  Current reading: ${fmt(m.currentReading)} ${m.unit}${f.readingDate ? ` on ${dateOnly(m.currentReadingAt)}` : ''}`);
  if (f.consumption) lines.push(`  Consumption: ${fmt(m.consumption)} ${m.unit}`);
  lines.push(`  Source: ${m.verificationNote}`);
  return lines;
}

export function renderTemplate(
  template: string,
  report: MunicipalReport,
  t: Pick<TemplateSettings, 'includeFields' | 'customMessage' | 'accountHolderName'>,
): string {
  const f = t.includeFields;
  const readings = report.meters.map((m) => readingLines(m, f).join('\n')).join('\n\n');
  const values: Record<(typeof PLACEHOLDERS)[number], string> = {
    property_name: report.property.name,
    property_address: f.propertyAddress ? report.property.address : report.property.name,
    account_number: f.accountNumber ? (report.municipalAccountNumber ?? '—') : '(not included)',
    account_holder: f.accountHolder ? (t.accountHolderName ?? '') : '',
    municipality: report.municipality?.name ?? '',
    period_start: report.period.start,
    period_end: report.period.end,
    readings,
    custom_message: t.customMessage ?? '',
    sender: report.preparedFor ?? 'The property owner',
  };
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, key: string) =>
      key in values ? values[key as keyof typeof values] : whole,
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface RenderedEmail {
  subject: string;
  bodyText: string;
}

export function renderEmail(report: MunicipalReport, t: TemplateSettings): RenderedEmail {
  const subject = renderTemplate(t.subjectTemplate ?? DEFAULT_SUBJECT, report, t).replace(/\s+/g, ' ').slice(0, 300);
  const bodyText = renderTemplate(t.bodyTemplate ?? DEFAULT_BODY, report, t);
  return { subject, bodyText };
}

/** Unknown placeholders in a template (shown to the user as a validation warning). */
export function unknownPlaceholders(template: string): string[] {
  const found = [...template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!);
  return [...new Set(found.filter((k) => !(PLACEHOLDERS as readonly string[]).includes(k)))];
}
