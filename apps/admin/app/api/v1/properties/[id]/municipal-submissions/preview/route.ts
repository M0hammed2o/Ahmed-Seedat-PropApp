import { NextResponse, type NextRequest } from 'next/server';
import { municipalPreviewSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { canReadUtilities, jsonError, loadReadableProperty, notFound, requireUser, serverError, utilitiesDisabled } from '@/lib/smartUtility/http';
import { buildPreview, renderPreviewPdf } from '@/lib/smartUtility/preview';

type RouteParams = { params: Promise<{ id: string }> };

type Authorised =
  | { ok: false; response: NextResponse }
  | { ok: true; property: NonNullable<Awaited<ReturnType<typeof loadReadableProperty>>> };

async function authorise(id: string): Promise<Authorised> {
  const auth = await requireUser();
  if ('response' in auth) return { ok: false, response: auth.response };
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property || !(await canReadUtilities(auth.supabase, property.org_id, property.id))) return { ok: false, response: notFound() };
  if (!property.utilities_enabled) return { ok: false, response: utilitiesDisabled() };
  return { ok: true, property };
}

/**
 * POST /api/v1/properties/:id/municipal-submissions/preview — exactly what would be sent for the
 * last complete period: recipient(s), CC, subject, full body (text + HTML), attachments, the next
 * scheduled date, the content hash to approve, and warnings. Optional unsaved template edits
 * (body) are rendered for live preview; a draft preview can never be approved.
 */
export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params;
  const a = await authorise(id);
  if (!a.ok) return a.response;
  let draft = null;
  const raw = await request.text();
  if (raw.trim()) {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonError(400, 'invalid_json', 'Request body must be valid JSON.');
    }
    const parsed = municipalPreviewSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, 'validation_failed', 'Check the template fields.');
    draft = Object.keys(parsed.data).length ? parsed.data : null;
  }
  try {
    const p = await buildPreview(getServiceRoleClient(), a.property.id, draft);
    return NextResponse.json({
      periodStart: p.report.period.start,
      periodEnd: p.report.period.end,
      to: p.rendered.to,
      cc: p.rendered.cc,
      subject: p.rendered.subject,
      bodyText: p.rendered.bodyText,
      bodyHtml: p.rendered.bodyHtml,
      attachments: p.rendered.attachments,
      photos: p.files.map((f) => ({ filename: f.filename, contentType: f.contentType, dataUrl: `data:${f.contentType};base64,${f.contentBase64}` })),
      templateHash: p.hash,
      isDraft: p.isDraft,
      approved: p.approved,
      scheduleEnabled: p.scheduleEnabled,
      scheduledFor: p.scheduledFor,
      warnings: p.warnings,
      meters: p.report.meters,
    });
  } catch (error) {
    return serverError('preview_failed', 'Could not build the preview.', 'municipal_preview', error);
  }
}

/** GET …/preview?format=pdf — the PDF that would be attached (saved template). */
export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params;
  const a = await authorise(id);
  if (!a.ok) return a.response;
  if (request.nextUrl.searchParams.get('format') !== 'pdf') return jsonError(400, 'invalid_format', 'Use ?format=pdf.');
  try {
    const p = await buildPreview(getServiceRoleClient(), a.property.id, null);
    const pdf = await renderPreviewPdf(p);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="preview-meter-readings-${p.report.period.end}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return serverError('preview_pdf_failed', 'Could not build the PDF preview.', 'municipal_preview_pdf', error);
  }
}
