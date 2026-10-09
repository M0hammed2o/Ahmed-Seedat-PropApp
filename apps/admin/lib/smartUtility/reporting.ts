import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { renderEmailTemplate } from '../emailDispatch';
import { writeAuditEvent } from '../audit';
import { getMunicipality } from './catalog';
import { billingPeriodContaining, lastCompleteBillingPeriod } from './consumption';
import { reportCsvFilename, reportPdfFilename, type MunicipalReport } from './municipalReport';
import {
  normaliseFields,
  renderEmail,
  templateHash,
  unknownPlaceholders,
  type TemplateSettings,
} from './templates';

// Municipal template context, preview and approval invalidation (docs/SMART_UTILITIES_DECISIONS.md #5).

export interface TemplateContext {
  settings: Record<string, unknown> | null;
  template: TemplateSettings;
  currentHash: string;
  approvedHash: string | null;
  authorisedRecipients: string[];
  scheduleEnabled: boolean;
}

export async function loadTemplateContext(serviceClient: SupabaseClient, propertyId: string): Promise<TemplateContext> {
  const [{ data: settings }, { data: recipients }] = await Promise.all([
    serviceClient.from('municipal_submission_settings').select('*').eq('property_id', propertyId).maybeSingle(),
    serviceClient
      .from('municipal_submission_recipients')
      .select('email')
      .eq('property_id', propertyId)
      .eq('active', true)
      .not('authorised_at', 'is', null),
  ]);
  const authorisedRecipients = (recipients ?? []).map((r) => r.email as string);
  const template: TemplateSettings = {
    subjectTemplate: (settings?.subject_template as string | null) ?? null,
    bodyTemplate: (settings?.body_template as string | null) ?? null,
    includeFields: normaliseFields(settings?.include_fields),
    customMessage: (settings?.custom_message as string | null) ?? null,
    accountHolderName: (settings?.account_holder_name as string | null) ?? null,
    ccEmails: (settings?.cc_emails as string[] | null) ?? [],
    recipients: authorisedRecipients,
  };
  return {
    settings: settings ?? null,
    template,
    currentHash: templateHash(template),
    approvedHash: (settings?.template_hash as string | null) ?? null,
    authorisedRecipients,
    scheduleEnabled: settings?.schedule_enabled === true,
  };
}

/** True when the owner's approval still covers exactly what would be sent now. */
export function approvalIsCurrent(ctx: TemplateContext): boolean {
  return !!ctx.approvedHash && ctx.approvedHash === ctx.currentHash && !!ctx.settings?.template_approved_at;
}

/** Anything that changes the sent content withdraws approval and switches scheduled sending off. */
export async function invalidateTemplateApproval(
  serviceClient: SupabaseClient,
  args: { propertyId: string; orgId: string; actorUserId: string | null; reason: string },
): Promise<boolean> {
  const { data } = await serviceClient
    .from('municipal_submission_settings')
    .update({ template_hash: null, template_approved_at: null, template_approved_by: null, schedule_enabled: false })
    .eq('property_id', args.propertyId)
    .not('template_approved_at', 'is', null)
    .select('id');
  if (data && data.length > 0) {
    await writeAuditEvent(serviceClient, {
      orgId: args.orgId,
      actorUserId: args.actorUserId,
      actorType: args.actorUserId ? 'user' : 'system',
      action: 'municipal_template.approval_withdrawn',
      entityType: 'municipal_submission_settings',
      entityId: data[0]!.id,
      after: { reason: args.reason },
    });
    return true;
  }
  return false;
}

/** The date the next pack will be prepared/sent: `leadDays` before the next billing boundary. */
export function nextSendDate(now: Date, billingDay: number, leadDays: number): Date {
  const current = billingPeriodContaining(now, billingDay);
  let candidate = new Date(current.end.getTime() - leadDays * 86_400_000);
  if (candidate.getTime() < now.getTime() - 86_400_000) {
    const next = billingPeriodContaining(new Date(current.end.getTime() + 1), billingDay);
    candidate = new Date(next.end.getTime() - leadDays * 86_400_000);
  }
  return candidate;
}

export interface RenderedPack {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  to: string[];
  cc: string[];
  attachments: { filename: string; contentType: string }[];
}

export function renderPack(report: MunicipalReport, template: TemplateSettings, photoCount: number): RenderedPack {
  const { subject, bodyText } = renderEmail(report, template);
  const html = renderEmailTemplate('municipal_meter_reading_report', {
    subject,
    bodyText,
    heading: `Meter readings — ${report.property.address}`,
    preparedFor: report.preparedFor,
  });
  return {
    subject,
    bodyText: html.bodyText,
    bodyHtml: html.bodyHtml,
    to: template.recipients,
    cc: template.ccEmails,
    attachments: [
      { filename: reportPdfFilename(report), contentType: 'application/pdf' },
      { filename: reportCsvFilename(report), contentType: 'text/csv' },
      ...(template.includeFields.photos ? Array.from({ length: photoCount }, (_, i) => ({ filename: `meter-photo-${i + 1}`, contentType: 'image/*' })) : []),
    ],
  };
}

export interface PreviewWarnings {
  unknownPlaceholders: string[];
  noAuthorisedRecipients: boolean;
  municipalityHasNoEmailChannel: boolean;
  noMunicipalMeter: boolean;
  missingReadings: number;
}

export function previewWarnings(report: MunicipalReport, ctx: TemplateContext): PreviewWarnings {
  const muni = getMunicipality((ctx.settings?.municipality_code as string | null) ?? null);
  return {
    unknownPlaceholders: [
      ...unknownPlaceholders(ctx.template.subjectTemplate ?? ''),
      ...unknownPlaceholders(ctx.template.bodyTemplate ?? ''),
    ],
    noAuthorisedRecipients: ctx.authorisedRecipients.length === 0,
    municipalityHasNoEmailChannel: !!muni && !muni.emailSubmission && muni.code !== 'other',
    noMunicipalMeter: report.meters.length === 0,
    missingReadings: report.meters.filter((m) => m.verification === 'missing').length,
  };
}

/** The period a preview should show: the last complete billing period. */
export function previewPeriod(now: Date, billingDay: number) {
  return lastCompleteBillingPeriod(now, billingDay);
}
