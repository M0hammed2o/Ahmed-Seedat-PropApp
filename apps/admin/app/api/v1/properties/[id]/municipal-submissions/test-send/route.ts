import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { dispatchEmail } from '@/lib/emailDispatch';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { writeAuditEvent } from '@/lib/audit';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, requireUser, serverError, utilitiesDisabled } from '@/lib/smartUtility/http';
import { renderReportCsv, reportCsvFilename, reportPdfFilename } from '@/lib/smartUtility/municipalReport';
import { buildPreview, renderPreviewPdf } from '@/lib/smartUtility/preview';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/properties/:id/municipal-submissions/test-send — sends the current (saved) pack to
 * the SIGNED-IN USER'S OWN account email only, subject prefixed [TEST], no CC. Never to a typed
 * address and never to a municipality. 5 per hour per user.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!property.utilities_enabled) return utilitiesDisabled();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  if (!auth.user.email) return jsonError(409, 'no_email', 'Your account has no email address.');
  const service = getServiceRoleClient();
  const limited = await rateLimitOrRespond(service, `municipal-test-send:${auth.user.id}`, 5, 3600);
  if (limited) return limited;
  try {
    const p = await buildPreview(service, property.id, null);
    const pdf = await renderPreviewPdf(p);
    const testId = crypto.randomUUID();
    const res = await dispatchEmail(service, {
      orgId: property.org_id,
      toAddress: auth.user.email,
      toUserId: auth.user.id,
      templateName: 'municipal_meter_reading_report',
      templateVars: {
        subject: `[TEST] ${p.rendered.subject}`,
        bodyText: `THIS IS A TEST — it was sent only to you. The real email would go to: ${p.rendered.to.join(', ') || '(no authorised recipients yet)'}${p.rendered.cc.length ? `; CC ${p.rendered.cc.join(', ')}` : ''}.\n\n${p.rendered.bodyText}`,
        heading: `TEST — Meter readings — ${p.report.property.address}`,
        preparedFor: p.report.preparedFor,
      },
      relatedEntityType: 'municipal_template_test',
      relatedEntityId: testId,
      actorUserId: auth.user.id,
      files: [
        { filename: reportPdfFilename(p.report), contentBase64: pdf.toString('base64'), contentType: 'application/pdf' },
        { filename: reportCsvFilename(p.report), contentBase64: Buffer.from(renderReportCsv(p.report)).toString('base64'), contentType: 'text/csv' },
        ...p.files,
      ],
    });
    await writeAuditEvent(service, {
      orgId: property.org_id,
      actorUserId: auth.user.id,
      actorType: 'user',
      action: 'municipal_template.test_sent',
      entityType: 'properties',
      entityId: property.id,
      after: { templateHash: p.hash, deliveryConfigured: res.deliveryConfigured },
    });
    return NextResponse.json({
      sentTo: auth.user.email,
      deliveryConfigured: res.deliveryConfigured,
      message: res.deliveryConfigured
        ? `Test sent to ${auth.user.email}.`
        : 'Email delivery is not configured on this server, so nothing left it (mock provider).',
    });
  } catch (error) {
    return serverError('test_send_failed', 'Could not send the test.', 'municipal_test_send', error);
  }
}
