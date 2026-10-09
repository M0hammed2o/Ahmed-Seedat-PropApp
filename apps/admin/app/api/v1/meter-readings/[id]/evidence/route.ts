import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { downloadProtectedObject } from '@/lib/protectedStorage';
import { canReadUtilities, notFound, requireUser, serverError } from '@/lib/smartUtility/http';
import { renderEvidencePdf } from '@/lib/smartUtility/municipalReport';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/meter-readings/:id/evidence — one-page PDF: the meter photo beside the reading, meter
 * identity, date, who recorded it, source and verification. The photo is read through the
 * protected-storage ownership check, keyed to the READING's organisation.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const { data: r } = await auth.supabase
    .from('meter_telemetry_readings')
    .select('id, org_id, property_id, meter_id, read_at, value, source, verification_status, verified_by, verified_at, verification_note, recorded_by, document_id, notes')
    .eq('id', id)
    .maybeSingle();
  if (!r || !(await canReadUtilities(auth.supabase, r.org_id, r.property_id))) return notFound('Reading');
  try {
    const service = getServiceRoleClient();
    const [{ data: meter }, { data: property }] = await Promise.all([
      service.from('utility_meters').select('utility_type, meter_number, serial_number, meter_role, unit_id, location').eq('id', r.meter_id).single(),
      service.from('properties').select('nickname, full_address').eq('id', r.property_id).single(),
    ]);
    const people = [r.recorded_by, r.verified_by].filter((x): x is string => !!x);
    const { data: profiles } = people.length
      ? await service.from('profiles').select('id, display_name').in('id', people)
      : { data: [] as { id: string; display_name: string | null }[] };
    const name = (uid: string | null) => (uid ? (profiles ?? []).find((p) => p.id === uid)?.display_name ?? 'A team member' : null);

    let image: Buffer | null = null;
    let imageCaption = 'No photo was attached to this reading.';
    if (r.document_id) {
      const { data: doc } = await service
        .from('documents')
        .select('storage_path, mime_type, original_file_name, created_at')
        .eq('id', r.document_id)
        .eq('org_id', r.org_id)
        .is('deleted_at', null)
        .maybeSingle();
      if (doc && (doc.mime_type === 'image/jpeg' || doc.mime_type === 'image/png')) {
        const read = await downloadProtectedObject(service, { orgId: r.org_id, storagePath: doc.storage_path });
        if (read.ok) {
          image = Buffer.from(await read.value.arrayBuffer());
          imageCaption = `Original photo: ${doc.original_file_name ?? 'meter photo'} (uploaded ${new Date(doc.created_at).toISOString().slice(0, 10)})`;
        }
      } else if (doc) {
        imageCaption = `Photo on file (${doc.mime_type}); this format cannot be embedded in the PDF.`;
      }
    }
    const isWater = meter?.utility_type === 'water';
    const pdf = await renderEvidencePdf({
      propertyName: property?.nickname ?? 'Property',
      propertyAddress: property?.full_address ?? '',
      meterLabel: `${meter?.meter_role ?? 'meter'}${meter?.location ? ` — ${meter.location}` : ''}`,
      meterNumber: meter?.meter_number ?? null,
      serialNumber: meter?.serial_number ?? null,
      utilityType: isWater ? 'water' : 'electricity',
      reading: Number(r.value) / (isWater ? 1000 : 1),
      unit: isWater ? 'kL' : 'kWh',
      readAt: r.read_at,
      submittedBy: r.source === 'manual' ? name(r.recorded_by) : `Device (${r.source})`,
      source: r.source,
      verificationStatus: r.verification_status,
      verifiedBy: name(r.verified_by),
      verifiedAt: r.verified_at,
      note: r.verification_note ?? r.notes ?? null,
      image,
      imageCaption,
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="meter-evidence-${r.read_at.slice(0, 10)}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return serverError('evidence_report_failed', 'Could not build the evidence report.', 'meter_readings.evidence', error);
  }
}
