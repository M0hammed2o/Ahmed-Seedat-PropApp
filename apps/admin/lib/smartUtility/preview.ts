import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PdfImage } from './municipalReport';
import { renderReportPdf } from './municipalReport';
import { billingPeriodContaining } from './consumption';
import { loadTemplateContext, nextSendDate, previewWarnings, renderPack, type TemplateContext } from './reporting';
import { buildReportForProperty, loadPhotoFiles, loadPropertyForReport } from './submissions';
import { normaliseFields, templateHash, type TemplateSettings } from './templates';

// One builder for the preview JSON, the preview PDF, the test send and the approval snapshot, so
// what the owner sees is byte-for-byte what is approved and later sent.

export interface DraftOverrides {
  subjectTemplate?: string | null;
  bodyTemplate?: string | null;
  customMessage?: string | null;
  accountHolderName?: string | null;
  includeFields?: Record<string, boolean>;
}

export async function buildPreview(
  serviceClient: SupabaseClient,
  propertyId: string,
  draft: DraftOverrides | null,
  now = new Date(),
) {
  const property = await loadPropertyForReport(serviceClient, propertyId);
  if (!property) throw new Error('Property not found');
  const ctx: TemplateContext = await loadTemplateContext(serviceClient, propertyId);
  const s = ctx.settings ?? {};
  const billingDay = (s.billing_day as number | undefined) ?? 25;
  const leadDays = (s.lead_days as number | undefined) ?? 5;
  const template: TemplateSettings = draft
    ? {
        ...ctx.template,
        ...(draft.subjectTemplate !== undefined ? { subjectTemplate: draft.subjectTemplate || null } : {}),
        ...(draft.bodyTemplate !== undefined ? { bodyTemplate: draft.bodyTemplate || null } : {}),
        ...(draft.customMessage !== undefined ? { customMessage: draft.customMessage || null } : {}),
        ...(draft.accountHolderName !== undefined ? { accountHolderName: draft.accountHolderName || null } : {}),
        ...(draft.includeFields ? { includeFields: normaliseFields(draft.includeFields) } : {}),
      }
    : ctx.template;
  // Preview the period the NEXT send will cover (the one containing its scheduled date), so the
  // owner approves the same period that is later sent -- not the last complete one.
  const scheduledFor = nextSendDate(now, billingDay, leadDays);
  const period = billingPeriodContaining(scheduledFor, billingDay);
  const report = await buildReportForProperty(
    serviceClient,
    property,
    {
      municipality_code: (s.municipality_code as string | null) ?? null,
      municipal_account_number: (s.municipal_account_number as string | null) ?? null,
    },
    period,
    now,
  );
  const includePhotos = (s.include_photos as boolean | undefined ?? true) && template.includeFields.photos;
  const files = includePhotos ? await loadPhotoFiles(serviceClient, property.org_id, report) : [];
  const rendered = renderPack(report, template, files.length);
  const hash = templateHash(template);
  return {
    property,
    report,
    template,
    rendered,
    files,
    hash,
    isDraft: !!draft,
    approvedHash: ctx.approvedHash,
    approved: !draft && !!ctx.approvedHash && ctx.approvedHash === hash,
    scheduleEnabled: ctx.scheduleEnabled,
    scheduledFor: scheduledFor.toISOString(),
    warnings: previewWarnings(report, { ...ctx, template }),
  };
}

export async function renderPreviewPdf(preview: Awaited<ReturnType<typeof buildPreview>>): Promise<Buffer> {
  const images: PdfImage[] = [];
  // Matched by document id (TD-60): a photo that could not be loaded no longer shifts later captions onto the
  // wrong meter.
  const byDocument = new Map(preview.files.map((f) => [f.documentId, f]));
  for (const m of preview.report.meters) {
    for (const docId of m.evidenceDocumentIds) {
      const f = byDocument.get(docId);
      if (f) images.push({ meterId: m.meterId, buffer: Buffer.from(f.contentBase64, 'base64'), caption: `Meter photo (${m.meterNumber ?? m.serialNumber ?? ''})` });
    }
  }
  return renderReportPdf(preview.report, { fields: preview.template.includeFields, images });
}
