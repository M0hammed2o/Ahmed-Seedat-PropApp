import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchEmail } from '../emailDispatch';
import { notifyPropertyStaff } from '../notify';
import { writeAuditEvent } from '../audit';
import { downloadProtectedObject } from '../protectedStorage';
import { approvalIsCurrent, loadTemplateContext, renderPack } from './reporting';
import { DEFAULT_INCLUDE_FIELDS, normaliseFields } from './templates';
import { getMunicipality } from './catalog';
import { lastCompleteBillingPeriod, sastInstant } from './consumption';
import {
  buildMunicipalReport,
  renderReportCsv,
  renderReportPdf,
  reportCsvFilename,
  reportPdfFilename,
  type MunicipalReport,
  type ReportMeterInput,
  type ReportPoint,
} from './municipalReport';

// Monthly municipal reading submissions (docs/SMART_UTILITY_ARCHITECTURE.md §8). Every function takes
// the service-role client: callers (routes, the daily job) authorise first. "Sent" is never treated
// as "accepted" -- acceptance_status only changes via recordAcceptance(), i.e. a human.

export const RETRY_DELAYS_MINUTES = [60, 360, 1440];
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;
const MAX_PHOTO_BYTES_TOTAL = 7 * 1024 * 1024;

export function isAutoSubmissionEnabled(): boolean {
  return process.env.SMART_UTILITY_AUTO_SUBMISSION_ENABLED === 'true';
}

/** Next retry time after `attempts` failed attempts, or null when attempts are exhausted. */
export function nextRetryAt(attempts: number, now: Date): Date | null {
  const delay = RETRY_DELAYS_MINUTES[attempts - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay * 60_000);
}

export interface SubmissionSettingsRow {
  property_id: string;
  org_id: string;
  municipality_code: string | null;
  municipal_account_number: string | null;
  mode: 'manual' | 'approval_required' | 'automatic';
  billing_day: number;
  lead_days: number;
  include_photos: boolean;
  enabled: boolean;
}

/** The mode actually applied: automatic degrades to approval while the platform flag is off. */
export function effectiveMode(mode: SubmissionSettingsRow['mode']): SubmissionSettingsRow['mode'] {
  return mode === 'automatic' && !isAutoSubmissionEnabled() ? 'approval_required' : mode;
}

/**
 * The submission period due on `now`, if any: a pack for the period ending on the next billing day
 * is prepared `lead_days` before it. Returns the period when today (SAST) is inside
 * [billing day - lead_days, billing day], else null.
 */
export function duePeriod(
  now: Date,
  billingDay: number,
  leadDays: number,
): { start: Date; end: Date } | null {
  // Period ending at the NEXT billing-day boundary on or after now.
  const prev = lastCompleteBillingPeriod(new Date(now.getTime() + (leadDays + 1) * 86_400_000), billingDay);
  const end = prev.end;
  const windowStart = new Date(end.getTime() - leadDays * 86_400_000);
  if (now >= windowStart && now <= new Date(end.getTime() + 86_400_000)) return prev;
  return null;
}

async function loadReportMeters(
  serviceClient: SupabaseClient,
  propertyId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<ReportMeterInput[]> {
  const { data: meters, error } = await serviceClient
    .from('utility_meters')
    .select('id, utility_type, meter_number, serial_number, register_digits, active, decommissioned_at')
    .eq('property_id', propertyId)
    .eq('ownership', 'municipal')
    .order('utility_type');
  if (error) throw new Error(`municipal meter lookup failed: ${error.message}`);

  const inputs: ReportMeterInput[] = [];
  // Look back far enough to find the previous period's reading.
  const lookback = new Date(periodStart.getTime() - 62 * 86_400_000).toISOString();
  for (const m of meters ?? []) {
    if (!m.active && m.decommissioned_at && new Date(m.decommissioned_at) < periodStart) continue;
    const [{ data: telemetry }, { data: monthly }] = await Promise.all([
      serviceClient
        .from('meter_telemetry_readings')
        .select('read_at, raw_value, value, multiplier, status, source, document_id, verification_status')
        .eq('meter_id', m.id)
        .gte('read_at', lookback)
        .lte('read_at', periodEnd.toISOString())
        .order('read_at'),
      serviceClient
        .from('utility_readings')
        .select('reading_date, reading_value, source, document_id')
        .eq('meter_id', m.id)
        .gte('reading_date', lookback.slice(0, 10))
        .lte('reading_date', periodEnd.toISOString().slice(0, 10)),
    ]);
    const points: ReportPoint[] = [
      ...(telemetry ?? []).map((t) => ({
        readAt: t.read_at,
        rawValue: Number(t.raw_value),
        value: Number(t.value),
        multiplier: Number(t.multiplier),
        status: t.status,
        source: t.source,
        documentId: t.document_id,
        verificationStatus: t.verification_status,
      })),
      // Migration-163 monthly manual readings (web panel / Android capture): litres or kWh as entered.
      ...(monthly ?? []).map((r) => {
        const [y, mo, d] = String(r.reading_date).split('-').map(Number);
        return {
          readAt: sastInstant(y!, mo!, d!, 12).toISOString(),
          rawValue: Number(r.reading_value),
          value: Number(r.reading_value),
          multiplier: 1,
          status: 'valid' as const,
          source: r.source === 'estimated' ? ('estimated' as const) : ('manual' as const),
          documentId: r.document_id,
        };
      }),
    ];
    inputs.push({
      meterId: m.id,
      utilityType: m.utility_type,
      meterNumber: m.meter_number,
      serialNumber: m.serial_number,
      registerDigits: m.register_digits,
      points: points.filter((p) => p.source !== 'estimated'),
    });
  }
  return inputs;
}

type PropertyForReport = {
  id: string;
  nickname: string | null;
  full_address: string | null;
  municipal_account_number: string | null;
  organizations: unknown;
};

/** The pack for one property and period (shared by generation and previews). */
export async function buildReportForProperty(
  serviceClient: SupabaseClient,
  property: PropertyForReport,
  cfg: Pick<SubmissionSettingsRow, 'municipality_code' | 'municipal_account_number'>,
  period: { start: Date; end: Date },
  now: Date,
): Promise<MunicipalReport> {
  const meters = await loadReportMeters(serviceClient, property.id, period.start, period.end);
  const municipality = getMunicipality(cfg.municipality_code);
  const org = (Array.isArray(property.organizations) ? property.organizations[0] : property.organizations) as
    | { trading_name?: string | null; legal_name?: string | null }
    | null;
  return buildMunicipalReport({
    propertyName: property.nickname ?? 'Property',
    propertyAddress: property.full_address ?? '',
    preparedFor: org?.trading_name ?? org?.legal_name ?? null,
    municipality: municipality ? { code: municipality.code, name: municipality.name } : null,
    municipalAccountNumber: cfg.municipal_account_number ?? property.municipal_account_number ?? null,
    periodStart: period.start,
    periodEnd: period.end,
    meters,
    now,
  });
}

export async function loadPropertyForReport(serviceClient: SupabaseClient, propertyId: string) {
  const { data } = await serviceClient
    .from('properties')
    .select('id, org_id, nickname, full_address, municipal_account_number, organizations(legal_name, trading_name)')
    .eq('id', propertyId)
    .single();
  return data as (PropertyForReport & { org_id: string }) | null;
}

export interface GenerateResult {
  submissionId: string;
  created: boolean;
  status: string;
}

export async function generateSubmission(
  serviceClient: SupabaseClient,
  args: {
    propertyId: string;
    period?: { start: Date; end: Date };
    actorUserId: string | null;
    now?: Date;
  },
): Promise<GenerateResult> {
  const now = args.now ?? new Date();
  const { data: property, error: propError } = await serviceClient
    .from('properties')
    .select('id, org_id, nickname, full_address, municipal_account_number, organizations(legal_name, trading_name)')
    .eq('id', args.propertyId)
    .single();
  if (propError || !property) throw new Error('Property not found');

  const { data: settings } = await serviceClient
    .from('municipal_submission_settings')
    .select('*')
    .eq('property_id', args.propertyId)
    .maybeSingle();
  const cfg: SubmissionSettingsRow = settings ?? {
    property_id: property.id,
    org_id: property.org_id,
    municipality_code: null,
    municipal_account_number: null,
    mode: 'manual',
    billing_day: 25,
    lead_days: 5,
    include_photos: true,
    enabled: false,
  };
  const period = args.period ?? lastCompleteBillingPeriod(now, cfg.billing_day);
  const periodStartDate = period.start.toISOString().slice(0, 10);

  const { data: existing } = await serviceClient
    .from('municipal_submissions')
    .select('id, status')
    .eq('property_id', args.propertyId)
    .eq('period_start', periodStartDate)
    .maybeSingle();
  if (existing) return { submissionId: existing.id, created: false, status: existing.status };

  const report = await buildReportForProperty(serviceClient, property, cfg, period, now);

  // Automatic sending only when EVERYTHING the owner approved is still exactly what would be sent:
  // platform flag on, schedule enabled, template hash unchanged, and an authorised recipient.
  const ctx = await loadTemplateContext(serviceClient, property.id);
  const mode = effectiveMode(cfg.mode);
  const canAutoSend =
    mode === 'automatic' && ctx.scheduleEnabled && approvalIsCurrent(ctx) && ctx.authorisedRecipients.length > 0;
  const status = mode === 'manual' ? 'draft' : canAutoSend ? 'scheduled' : 'pending_approval';
  const rendered = renderPack(report, ctx.template, report.meters.reduce((n, m) => n + m.evidenceDocumentIds.length, 0));
  const { data: inserted, error } = await serviceClient
    .from('municipal_submissions')
    .insert({
      org_id: property.org_id,
      property_id: property.id,
      period_start: periodStartDate,
      period_end: period.end.toISOString().slice(0, 10),
      status,
      mode,
      report,
      generated_by: args.actorUserId,
      approved_at: status === 'scheduled' ? now.toISOString() : null,
      scheduled_for: status === 'scheduled' ? now.toISOString() : null,
      template_hash: ctx.currentHash,
      // Audit trail: exactly what will be sent (subject, body, recipients, attachments).
      rendered_email: { ...rendered, templateHash: ctx.currentHash, includeFields: ctx.template.includeFields },
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') {
      const { data: raced } = await serviceClient
        .from('municipal_submissions')
        .select('id, status')
        .eq('property_id', args.propertyId)
        .eq('period_start', periodStartDate)
        .single();
      return { submissionId: raced!.id, created: false, status: raced!.status };
    }
    throw new Error(`submission insert failed: ${error.message}`);
  }

  await writeAuditEvent(serviceClient, {
    orgId: property.org_id,
    actorUserId: args.actorUserId,
    actorType: args.actorUserId ? 'user' : 'system',
    action: 'municipal_submission.generated',
    entityType: 'municipal_submissions',
    entityId: inserted.id,
    after: { periodStart: periodStartDate, mode, status, meterCount: report.meters.length },
  });

  if (status === 'scheduled') {
    await freezePack(serviceClient, inserted.id, now);
    await createDeliveries(serviceClient, inserted.id, { authorisedOnly: true });
  } else if (status === 'pending_approval') {
    await notifyPropertyStaff(serviceClient, {
      orgId: property.org_id,
      propertyId: property.id,
      type: 'municipal_submission_pending',
      title: `Meter readings ready for approval — ${property.nickname ?? 'property'}`,
      body: `The ${report.period.start} to ${report.period.end} municipal reading pack is ready. Review and approve it before it is sent.`,
      relatedEntityType: 'municipal_submissions',
      relatedEntityId: inserted.id,
      minRole: 'accountant',
    });
  }
  return { submissionId: inserted.id, created: true, status };
}

/** Creates one delivery row per active, owner-authorised recipient. Idempotent. */
export async function createDeliveries(
  serviceClient: SupabaseClient,
  submissionId: string,
  _opts: { authorisedOnly: true },
): Promise<number> {
  const { data: sub } = await serviceClient
    .from('municipal_submissions')
    .select('id, org_id, property_id, rendered_email')
    .eq('id', submissionId)
    .single();
  if (!sub) throw new Error('Submission not found');
  const { data: authorisedRows } = await serviceClient
    .from('municipal_submission_recipients')
    .select('id, email, recipient_type')
    .eq('property_id', sub.property_id)
    .eq('active', true)
    .not('authorised_at', 'is', null);
  // Only addresses that were on the approved message AND are still authorised (MUN-B); a recipient added after
  // approval is not sent the pack until it is approved again.
  const frozen = (sub.rendered_email as { frozen?: FrozenPack } | null)?.frozen;
  const approvedTo = frozen ? new Set(frozen.to.map((e) => e.toLowerCase())) : null;
  const recipients = (authorisedRows ?? []).filter((r) => !approvedTo || approvedTo.has(String(r.email).toLowerCase()));
  if (recipients.length === 0) return 0;
  const { data: cfg } = await serviceClient
    .from('municipal_submission_settings')
    .select('cc_emails')
    .eq('property_id', sub.property_id)
    .maybeSingle();
  const cc = frozen ? frozen.cc : ((cfg?.cc_emails as string[] | null) ?? []);
  const { error } = await serviceClient.from('municipal_submission_deliveries').upsert(
    recipients.map((r, i) => ({
      org_id: sub.org_id,
      property_id: sub.property_id,
      submission_id: sub.id,
      recipient_id: r.id,
      recipient_email: r.email,
      recipient_type: r.recipient_type,
      status: 'pending',
      next_attempt_at: new Date().toISOString(),
      // CC only on the first recipient's message, so CC addresses receive the pack once.
      cc_emails: i === 0 ? cc : [],
    })),
    { onConflict: 'submission_id,recipient_email', ignoreDuplicates: true },
  );
  if (error) throw new Error(`delivery insert failed: ${error.message}`);
  return recipients.length;
}

export async function approveSubmission(
  serviceClient: SupabaseClient,
  args: { submissionId: string; actorUserId: string; now?: Date },
): Promise<{ deliveries: number }> {
  const now = args.now ?? new Date();
  const { data: sub } = await serviceClient
    .from('municipal_submissions')
    .select('id, org_id, property_id, status')
    .eq('id', args.submissionId)
    .single();
  if (!sub) throw new Error('Submission not found');
  if (!['draft', 'pending_approval', 'approved', 'scheduled'].includes(sub.status)) {
    throw new SubmissionStateError(`A ${sub.status} submission cannot be approved`);
  }
  // Check before changing state, so a refused approval leaves the pack exactly as it was.
  const { count: authorised } = await serviceClient
    .from('municipal_submission_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', sub.property_id)
    .eq('active', true)
    .not('authorised_at', 'is', null);
  if (!authorised) {
    throw new SubmissionStateError(
      'There are no authorised recipients for this property. Add and authorise a recipient first.',
    );
  }
  await serviceClient
    .from('municipal_submissions')
    .update({ status: 'scheduled', approved_by: args.actorUserId, approved_at: now.toISOString(), scheduled_for: now.toISOString() })
    .eq('id', sub.id);
  await freezePack(serviceClient, sub.id, now);
  const deliveries = await createDeliveries(serviceClient, sub.id, { authorisedOnly: true });
  await writeAuditEvent(serviceClient, {
    orgId: sub.org_id,
    actorUserId: args.actorUserId,
    actorType: 'user',
    action: 'municipal_submission.approved',
    entityType: 'municipal_submissions',
    entityId: sub.id,
    after: { deliveries },
  });
  return { deliveries };
}

export class SubmissionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubmissionStateError';
  }
}

export async function loadPhotoFiles(
  serviceClient: SupabaseClient,
  orgId: string,
  report: MunicipalReport,
): Promise<{ documentId: string; filename: string; contentBase64: string; contentType?: string }[]> {
  const ids = report.meters.flatMap((m) => m.evidenceDocumentIds);
  if (ids.length === 0) return [];
  const { data: docs } = await serviceClient
    .from('documents')
    .select('id, storage_path, original_file_name, mime_type, file_size_bytes, org_id')
    .in('id', ids)
    .eq('org_id', orgId)
    .is('deleted_at', null);
  const files: { documentId: string; filename: string; contentBase64: string; contentType?: string }[] = [];
  let total = 0;
  // Report order (meter by meter), so the same pack always attaches the same photos in the same order.
  const order = new Map(ids.map((id, i) => [id, i]));
  const sorted = [...(docs ?? [])].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  for (const d of sorted) {
    if (!d.mime_type?.startsWith('image/')) continue;
    if (total + (d.file_size_bytes ?? 0) > MAX_PHOTO_BYTES_TOTAL) break;
    // Through the protected-storage ownership check (migration 172): the path must sit inside the
    // SUBMISSION's org folder, so a pack can never attach another organisation's file.
    const read = await downloadProtectedObject(serviceClient, { orgId, storagePath: d.storage_path });
    if (!read.ok) continue;
    const buf = Buffer.from(await read.value.arrayBuffer());
    total += buf.length;
    files.push({
      documentId: d.id,
      filename: `meter-photo-${d.id.slice(0, 8)}-${d.original_file_name ?? 'photo.jpg'}`,
      contentBase64: buf.toString('base64'),
      contentType: d.mime_type,
    });
  }
  return files;
}

/** What an approval covers, frozen so retries send exactly the same message (MUN-A/B). */
export interface FrozenPack {
  includePhotos: boolean;
  photos: { id: string; sha256: string; filename: string; contentType: string }[];
  to: string[];
  cc: string[];
  frozenAt: string;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Freezes the attachments (exact photo documents + content hashes) and the recipient list of a pack at approval or
 * scheduling time. Idempotent: an existing frozen snapshot is never replaced.
 */
export async function freezePack(serviceClient: SupabaseClient, submissionId: string, now: Date): Promise<FrozenPack> {
  const { data: sub } = await serviceClient
    .from('municipal_submissions')
    .select('id, org_id, property_id, report, rendered_email')
    .eq('id', submissionId)
    .single();
  if (!sub) throw new Error('Submission not found');
  const rendered = (sub.rendered_email ?? {}) as Record<string, unknown> & { frozen?: FrozenPack; includeFields?: unknown; to?: string[]; cc?: string[] };
  if (rendered.frozen) return rendered.frozen;
  const { data: settings } = await serviceClient
    .from('municipal_submission_settings')
    .select('include_photos')
    .eq('property_id', sub.property_id)
    .maybeSingle();
  const fields = rendered.includeFields ? normaliseFields(rendered.includeFields) : DEFAULT_INCLUDE_FIELDS;
  const includePhotos = (settings?.include_photos ?? true) && fields.photos;
  const photos: FrozenPack['photos'] = [];
  if (includePhotos) {
    const files = await loadPhotoFiles(serviceClient, sub.org_id, sub.report as MunicipalReport);
    for (const f of files) {
      photos.push({ id: f.documentId, sha256: sha256(Buffer.from(f.contentBase64, 'base64')), filename: f.filename, contentType: f.contentType ?? 'image/jpeg' });
    }
  }
  const frozen: FrozenPack = {
    includePhotos,
    photos,
    to: Array.isArray(rendered.to) ? rendered.to : [],
    cc: Array.isArray(rendered.cc) ? rendered.cc : [],
    frozenAt: now.toISOString(),
  };
  await serviceClient.from('municipal_submissions').update({ rendered_email: { ...rendered, frozen } }).eq('id', sub.id);
  return frozen;
}

/** Loads exactly the frozen photos; refuses (throws) if any is missing or its content changed since approval. */
async function loadFrozenPhotos(serviceClient: SupabaseClient, orgId: string, frozen: FrozenPack) {
  if (!frozen.includePhotos || frozen.photos.length === 0) return [];
  const { data: docs } = await serviceClient
    .from('documents')
    .select('id, storage_path')
    .in('id', frozen.photos.map((p) => p.id))
    .eq('org_id', orgId)
    .is('deleted_at', null);
  const byId = new Map((docs ?? []).map((d) => [d.id as string, d.storage_path as string]));
  const files: { filename: string; contentBase64: string; contentType?: string }[] = [];
  for (const p of frozen.photos) {
    const path = byId.get(p.id);
    if (!path) throw new Error(`An approved photo (${p.filename}) is no longer available; re-approve the pack.`);
    const read = await downloadProtectedObject(serviceClient, { orgId, storagePath: path });
    if (!read.ok) throw new Error(`An approved photo (${p.filename}) could not be read; re-approve the pack.`);
    const buf = Buffer.from(await read.value.arrayBuffer());
    if (sha256(buf) !== p.sha256) throw new Error(`An approved photo (${p.filename}) changed after approval; re-approve the pack.`);
    files.push({ filename: p.filename, contentBase64: buf.toString('base64'), contentType: p.contentType });
  }
  return files;
}

export interface SendResult {
  attempted: number;
  sent: number;
  failed: number;
  exhausted: number;
}

type EmailSender = typeof dispatchEmail;

/**
 * Sends every due delivery (pending, or failed with next_attempt_at <= now and attempts left) for
 * APPROVED/SENDING/PARTIALLY_FAILED submissions. `sender` is injectable so retry behaviour is
 * testable without a real provider.
 */
export async function sendDueDeliveries(
  serviceClient: SupabaseClient,
  args: { submissionId?: string; now?: Date; sender?: EmailSender } = {},
): Promise<SendResult> {
  const now = args.now ?? new Date();
  const sender = args.sender ?? dispatchEmail;
  let query = serviceClient
    .from('municipal_submission_deliveries')
    .select('id, org_id, property_id, submission_id, recipient_email, cc_emails, attempts, status')
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_DELIVERY_ATTEMPTS)
    .lte('next_attempt_at', now.toISOString())
    .limit(200);
  if (args.submissionId) query = query.eq('submission_id', args.submissionId);
  const { data: due, error } = await query;
  if (error) throw new Error(`delivery lookup failed: ${error.message}`);

  const result: SendResult = { attempted: 0, sent: 0, failed: 0, exhausted: 0 };
  const touched = new Set<string>();
  const cache = new Map<
    string,
    {
      report: MunicipalReport;
      status: string;
      scheduledFor: string | null;
      rendered: { subject?: string; bodyText?: string; includeFields?: unknown } | null;
      files: { filename: string; contentBase64: string; contentType?: string }[] | null;
      filesError: string | null;
      propertyId: string;
      automaticUnapproved: boolean;
    }
  >();

  for (const d of due ?? []) {
    let entry = cache.get(d.submission_id);
    if (!entry) {
      const { data: sub } = await serviceClient
        .from('municipal_submissions')
        .select('report, status, property_id, org_id, scheduled_for, rendered_email, approved_by, mode')
        .eq('id', d.submission_id)
        .single();
      if (!sub) continue;
      const rendered = (sub.rendered_email as { subject?: string; bodyText?: string; includeFields?: unknown; frozen?: FrozenPack } | null) ?? null;
      // Packs approved before freezing existed are frozen on first send, so every retry matches the first attempt.
      const frozen = rendered?.frozen ?? (await freezePack(serviceClient, d.submission_id, now));
      let files: { filename: string; contentBase64: string; contentType?: string }[] | null = null;
      let filesError: string | null = null;
      try {
        files = await loadFrozenPhotos(serviceClient, sub.org_id, frozen);
      } catch (err) {
        filesError = err instanceof Error ? err.message : 'Approved attachments unavailable.';
      }
      // A pack scheduled automatically (nobody pressed Approve) only goes out while the platform flag is on and the
      // owner-approved template still matches exactly (MUN-C).
      let automaticUnapproved = false;
      if (sub.mode === 'automatic' && !sub.approved_by) {
        const ctx = await loadTemplateContext(serviceClient, sub.property_id);
        automaticUnapproved = !isAutoSubmissionEnabled() || !ctx.scheduleEnabled || !approvalIsCurrent(ctx);
      }
      entry = {
        report: sub.report as MunicipalReport,
        status: sub.status,
        scheduledFor: sub.scheduled_for as string | null,
        rendered,
        files,
        filesError,
        propertyId: sub.property_id,
        automaticUnapproved,
      };
      cache.set(d.submission_id, entry);
    }
    if (!['approved', 'scheduled', 'sending', 'partially_failed', 'failed'].includes(entry.status)) continue;
    if (entry.scheduledFor && new Date(entry.scheduledFor).getTime() > now.getTime()) continue;

    // Claim the delivery (compare-and-set on attempts) so two overlapping job runs never send it twice (MUN-D).
    const attempts = d.attempts + 1;
    const { data: claimed } = await serviceClient
      .from('municipal_submission_deliveries')
      .update({ attempts, last_attempt_at: now.toISOString() })
      .eq('id', d.id)
      .eq('attempts', d.attempts)
      .in('status', ['pending', 'failed'])
      .select('id');
    if (!claimed || claimed.length === 0) continue;
    result.attempted += 1;
    touched.add(d.submission_id);
    // Stop conditions that must NOT be retried: recipient withdrawn, or an automatic send no longer allowed.
    const { data: stillAuthorised } = await serviceClient
      .from('municipal_submission_recipients')
      .select('id')
      .eq('property_id', entry.propertyId)
      .ilike('email', d.recipient_email)
      .eq('active', true)
      .not('authorised_at', 'is', null)
      .limit(1);
    const stopReason = !stillAuthorised || stillAuthorised.length === 0
      ? 'Not sent: this recipient is no longer authorised.'
      : entry.automaticUnapproved
        ? 'Not sent: automatic sending is off or the approved template changed. Approve the pack to send it.'
        : null;
    if (stopReason) {
      await serviceClient
        .from('municipal_submission_deliveries')
        .update({ status: 'failed', next_attempt_at: null, last_error: stopReason })
        .eq('id', d.id);
      result.failed += 1;
      result.exhausted += 1;
      continue;
    }
    try {
      if (entry.filesError || !entry.files) throw new Error(entry.filesError ?? 'Approved attachments unavailable.');
      const csv = renderReportCsv(entry.report);
      const fields = entry.rendered?.includeFields ? normaliseFields(entry.rendered.includeFields) : DEFAULT_INCLUDE_FIELDS;
      const pdf = await renderReportPdf(entry.report, { fields });
      const res = await sender(serviceClient, {
        orgId: d.org_id,
        toAddress: d.recipient_email,
        templateName: 'municipal_meter_reading_report',
        // The approved snapshot is what is sent, never a re-render of the current template.
        templateVars: {
          subject: entry.rendered?.subject ?? `Meter readings for ${entry.report.property.address} (${entry.report.period.end})`,
          bodyText: entry.rendered?.bodyText,
          heading: `Meter readings — ${entry.report.property.address}`,
          preparedFor: entry.report.preparedFor,
        },
        cc: (d.cc_emails as string[] | null) ?? [],
        relatedEntityType: 'municipal_submission_delivery',
        relatedEntityId: d.id,
        actorUserId: null,
        files: [
          { filename: reportCsvFilename(entry.report), contentBase64: Buffer.from(csv, 'utf8').toString('base64'), contentType: 'text/csv' },
          { filename: reportPdfFilename(entry.report), contentBase64: pdf.toString('base64'), contentType: 'application/pdf' },
          ...entry.files,
        ],
      });
      if (!res.sent && res.reason !== 'already_sent') {
        throw new Error(`not sent: ${res.reason ?? 'unknown'}`);
      }
      let providerMessageId: string | null = null;
      if (res.emailMessageId) {
        const { data: msg } = await serviceClient
          .from('email_messages')
          .select('provider_message_id')
          .eq('id', res.emailMessageId)
          .maybeSingle();
        providerMessageId = msg?.provider_message_id ?? null;
      }
      await serviceClient
        .from('municipal_submission_deliveries')
        .update({
          status: 'sent',
          last_attempt_at: now.toISOString(),
          next_attempt_at: null,
          last_error: res.deliveryConfigured ? null : 'Email provider not configured (mock): nothing left the server.',
          email_message_id: res.emailMessageId ?? null,
          provider_message_id: providerMessageId,
        })
        .eq('id', d.id);
      result.sent += 1;
    } catch (err) {
      const message = (err instanceof Error ? err.message : 'Unknown error').slice(0, 500);
      const retryAt = nextRetryAt(attempts, now);
      await serviceClient
        .from('municipal_submission_deliveries')
        .update({
          status: 'failed',
          last_attempt_at: now.toISOString(),
          next_attempt_at: retryAt ? retryAt.toISOString() : null,
          last_error: message,
        })
        .eq('id', d.id);
      result.failed += 1;
      if (!retryAt) {
        result.exhausted += 1;
        await notifyPropertyStaff(serviceClient, {
          orgId: d.org_id,
          propertyId: d.property_id,
          type: 'municipal_submission_failed',
          title: 'A meter-reading submission could not be sent',
          body: `Sending to ${d.recipient_email} failed ${attempts} times (${message}). Please check the address or send it yourself.`,
          relatedEntityType: 'municipal_submissions',
          relatedEntityId: d.submission_id,
          minRole: 'accountant',
        });
      }
    }
  }

  for (const id of touched) await rollupSubmissionStatus(serviceClient, id, now);
  return result;
}

/** Derives the submission status from its deliveries. */
export function rollupStatus(statuses: string[], attemptsLeft: boolean[]): string {
  if (statuses.length === 0) return 'approved';
  const ok = statuses.filter((s) => s === 'sent' || s === 'delivered').length;
  const terminalFail = statuses.filter((s, i) => s === 'bounced' || (s === 'failed' && !attemptsLeft[i])).length;
  if (ok === statuses.length) return 'sent';
  if (ok + terminalFail === statuses.length) return ok > 0 ? 'partially_failed' : 'failed';
  return 'sending';
}

export async function rollupSubmissionStatus(serviceClient: SupabaseClient, submissionId: string, now: Date) {
  const { data: rows } = await serviceClient
    .from('municipal_submission_deliveries')
    .select('status, attempts')
    .eq('submission_id', submissionId);
  const statuses = (rows ?? []).map((r) => r.status);
  const status = rollupStatus(
    statuses,
    (rows ?? []).map((r) => r.attempts < MAX_DELIVERY_ATTEMPTS),
  );
  await serviceClient
    .from('municipal_submissions')
    .update({ status, ...(status === 'sent' ? { sent_at: now.toISOString() } : {}) })
    .eq('id', submissionId)
    .in('status', ['approved', 'scheduled', 'sending', 'partially_failed', 'failed', 'sent']);
}

/** Mirrors Resend webhook outcomes (already applied to email_messages) onto delivery rows. */
export async function syncDeliveryStatuses(serviceClient: SupabaseClient, now: Date): Promise<number> {
  const { data: rows } = await serviceClient
    .from('municipal_submission_deliveries')
    .select('id, submission_id, email_message_id, status')
    .eq('status', 'sent')
    .not('email_message_id', 'is', null)
    .limit(500);
  let changed = 0;
  const touched = new Set<string>();
  // One query for all messages (was one per delivery).
  const ids = (rows ?? []).map((r) => r.email_message_id as string);
  const { data: messages } = ids.length
    ? await serviceClient.from('email_messages').select('id, status, failure_reason').in('id', ids).in('status', ['delivered', 'bounced'])
    : { data: [] as { id: string; status: string; failure_reason: string | null }[] };
  const byId = new Map((messages ?? []).map((m) => [m.id, m]));
  for (const r of rows ?? []) {
    const msg = byId.get(r.email_message_id as string);
    const next = msg?.status === 'delivered' ? 'delivered' : msg?.status === 'bounced' ? 'bounced' : null;
    if (next) {
      await serviceClient
        .from('municipal_submission_deliveries')
        .update({ status: next, last_error: next === 'bounced' ? (msg?.failure_reason ?? 'Bounced') : null })
        .eq('id', r.id);
      touched.add(r.submission_id);
      changed += 1;
    }
  }
  for (const id of touched) await rollupSubmissionStatus(serviceClient, id, now);
  return changed;
}

export async function recordAcceptance(
  serviceClient: SupabaseClient,
  args: {
    submissionId: string;
    actorUserId: string;
    acceptanceStatus: 'accepted' | 'rejected' | 'unknown' | 'not_applicable';
    reference?: string | null;
    notes?: string | null;
    now?: Date;
  },
) {
  const now = args.now ?? new Date();
  const { data: sub } = await serviceClient
    .from('municipal_submissions')
    .update({
      acceptance_status: args.acceptanceStatus,
      submission_reference: args.reference ?? null,
      acceptance_notes: args.notes ?? null,
      acceptance_recorded_by: args.actorUserId,
      acceptance_recorded_at: now.toISOString(),
    })
    .eq('id', args.submissionId)
    .select('id, org_id')
    .single();
  if (!sub) throw new Error('Submission not found');
  await writeAuditEvent(serviceClient, {
    orgId: sub.org_id,
    actorUserId: args.actorUserId,
    actorType: 'user',
    action: 'municipal_submission.acceptance_recorded',
    entityType: 'municipal_submissions',
    entityId: sub.id,
    after: { acceptanceStatus: args.acceptanceStatus, reference: args.reference ?? null },
  });
}
