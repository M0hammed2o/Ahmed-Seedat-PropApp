import { NextResponse, type NextRequest } from 'next/server';
import { jsonError, notFound, requireUser } from '@/lib/smartUtility/http';
import { renderReportCsv, renderReportPdf, type MunicipalReport } from '@/lib/smartUtility/municipalReport';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/municipal-submissions/:id/export?format=csv|pdf -- the stored pack, for the owner to
 * submit themselves (manual mode, or app/portal-only municipalities). RLS-scoped read.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const format = request.nextUrl.searchParams.get('format') ?? 'pdf';
  if (format !== 'csv' && format !== 'pdf') return jsonError(400, 'invalid_format', 'format must be csv or pdf.');
  const { data: sub } = await auth.supabase
    .from('municipal_submissions')
    .select('id, report')
    .eq('id', id)
    .maybeSingle();
  if (!sub) return notFound('Submission');
  const report = sub.report as MunicipalReport;
  const filename = `meter-readings-${report.period.end}.${format}`;
  if (format === 'csv') {
    return new NextResponse(renderReportCsv(report), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }
  const pdf = await renderReportPdf(report);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
