import 'server-only';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

// Lease preparation (Phase M, WORKLOG.md 2026-08-25): the real DOCX-template merge engine.
// docxtemplater handles Word's own run-splitting (a placeholder like {{tenant_full_name}} can be
// stored across multiple <w:r> XML runs if it was ever re-typed/spell-checked in Word -- naive
// string replacement against the raw XML would silently miss those and is exactly what this
// library exists to avoid). Never executes macros; DOCM is rejected upstream, before this is ever
// reached, by leaseTemplateValidation.ts.

export const MERGE_FIELD_KEYS = [
  'tenant_full_name',
  'tenant_id_number',
  'tenant_email',
  'tenant_phone',
  'tenant_address',
  'property_name',
  'property_address',
  'unit_label',
  'bedrooms',
  'bathrooms',
  'monthly_rent',
  'deposit',
  'lease_start_date',
  'lease_end_date',
  'rental_due_day',
  'annual_escalation',
  'landlord_name',
  'organisation_name',
  'approved_occupants',
  'parking',
  'utilities',
  'special_conditions',
] as const;

export type LeaseMergeFieldKey = (typeof MERGE_FIELD_KEYS)[number];
export type LeaseMergeFields = Partial<Record<LeaseMergeFieldKey, string>>;

// The legal/commercial minimum a lease cannot be generated without -- everything else (deposit
// beyond zero, end date, due day, escalation, occupants, parking, utilities, special conditions)
// is legitimately optional and renders as an empty string rather than blocking generation. Never
// invent a value for any of these -- a missing required field blocks generation outright instead.
const REQUIRED_MERGE_FIELDS: LeaseMergeFieldKey[] = [
  'tenant_full_name',
  'property_name',
  'property_address',
  'unit_label',
  'monthly_rent',
  'lease_start_date',
  'landlord_name',
  'organisation_name',
];

export type LeaseMergeResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: string; missingFields?: string[] };

export function mergeLeaseTemplate(templateBuffer: Buffer, fields: LeaseMergeFields): LeaseMergeResult {
  const missingFields = REQUIRED_MERGE_FIELDS.filter((key) => !fields[key] || fields[key]!.trim() === '');
  if (missingFields.length > 0) {
    return {
      ok: false,
      reason: 'The lease is missing required details and cannot be generated yet.',
      missingFields,
    };
  }

  let zip: PizZip;
  try {
    zip = new PizZip(templateBuffer);
  } catch {
    return { ok: false, reason: 'The lease template is not a valid DOCX (not a readable zip archive).' };
  }

  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // {{double_brace}} placeholders, matching the merge-field list organisations are told to use
      // in their templates -- docxtemplater's own default is single braces, overridden here.
      delimiters: { start: '{{', end: '}}' },
      // Any placeholder in the template this app doesn't know how to fill renders as an empty
      // string rather than throwing or inventing a value -- the review UI (Phase O) surfaces the
      // known-field checklist so staff can see what was actually populated before sending.
      nullGetter: () => '',
    });
  } catch (error) {
    return { ok: false, reason: `The lease template could not be parsed: ${describeError(error)}` };
  }

  const data: Record<string, string> = {};
  for (const key of MERGE_FIELD_KEYS) {
    data[key] = fields[key] ?? '';
  }

  try {
    doc.render(data);
  } catch (error) {
    return { ok: false, reason: `Failed to merge the lease template: ${describeError(error)}` };
  }

  const buffer = doc.getZip().generate({ type: 'nodebuffer' }) as Buffer;
  return { ok: true, buffer };
}

interface DocxtemplaterErrorLike {
  message?: string;
  properties?: { errors?: Array<{ properties?: { explanation?: string } }> };
}

function describeError(error: unknown): string {
  const err = error as DocxtemplaterErrorLike;
  const nested = err.properties?.errors?.map((e) => e.properties?.explanation).filter(Boolean);
  if (nested && nested.length > 0) return nested.join('; ');
  return err.message ?? 'unknown error';
}
