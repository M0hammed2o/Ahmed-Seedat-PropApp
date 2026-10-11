import { NextResponse, type NextRequest } from 'next/server';
import { tariffPreviewSchema } from '@propvault/validation';
import { jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError, utilitiesDisabled } from '@/lib/smartUtility/http';
import { meterUsage, TARIFF_COLUMNS, toTariffV2, type TariffRow } from '@/lib/smartUtility/billing';
import { sastInstant } from '@/lib/smartUtility/consumption';
import { computeTariffCharge, type TariffV2 } from '@/lib/smartUtility/tariffEngine';
import { inputToTariffV2, tariffProblem } from '@/lib/smartUtility/tariffAdmin';

type RouteParams = { params: Promise<{ id: string }> };

const toSast = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return sastInstant(y!, m!, day!);
};
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * POST — calculation preview. Price a saved tariff (tariffId) or an unsaved draft (tariff) against either an entered
 * consumption or a meter's measured use over the period. Nothing is stored. Read access is enough.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, tariffPreviewSchema);
  if ('response' in parsed) return parsed.response;
  const d = parsed.data;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!property.utilities_enabled) return utilitiesDisabled();
  if (d.periodEnd <= d.periodStart) return jsonError(400, 'validation_failed', 'The period end must be after its start.');
  const segStart = d.segmentStart ?? d.periodStart;
  const segEnd = d.segmentEnd ?? d.periodEnd;
  if (segStart < d.periodStart || segEnd > d.periodEnd || segEnd <= segStart) {
    return jsonError(400, 'validation_failed', 'The segment must lie inside the period.');
  }
  try {
    let tariff: TariffV2;
    if (d.tariffId) {
      const { data } = await auth.supabase.from('utility_tariffs').select(TARIFF_COLUMNS).eq('id', d.tariffId).eq('property_id', property.id).maybeSingle();
      if (!data) return notFound('Tariff');
      tariff = toTariffV2(data as TariffRow);
    } else if (d.tariff) {
      const problem = tariffProblem(d.tariff);
      if (problem) return jsonError(400, 'invalid_tariff', problem);
      tariff = inputToTariffV2(d.tariff);
    } else {
      return jsonError(400, 'validation_failed', 'Provide tariffId or tariff.');
    }
    let consumption = d.consumption ?? null;
    let daily: { date: string; value: number | null }[] | undefined;
    let hourly: { start: Date; value: number | null }[] | undefined;
    let quality: string | null = null;
    if (d.meterId) {
      const usage = await meterUsage(auth.supabase, d.meterId, segStart, segEnd);
      if (!usage || usage.meter.property_id !== property.id) return notFound('Meter');
      if (usage.meter.utility_type !== tariff.utilityType) return jsonError(400, 'validation_failed', 'The meter and tariff are for different utilities.');
      consumption = usage.consumption;
      daily = usage.daily;
      hourly = usage.hourly;
      quality = usage.quality;
    }
    const result = computeTariffCharge(tariff, {
      consumption,
      segmentStart: toSast(segStart),
      segmentEnd: toSast(segEnd),
      periodDays: days(d.periodStart, d.periodEnd),
      daily,
      hourly,
      allowanceQuantity: d.allowanceQuantity ?? null,
    });
    return NextResponse.json({ consumption, quality, result });
  } catch (error) {
    return serverError('tariff_preview_failed', 'Could not calculate the preview.', 'utility_tariffs.preview', error);
  }
}
