import { NextResponse, type NextRequest } from 'next/server';
import { tariffImportSchema } from '@propvault/validation';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';
import { createTariff, parseTariffCsv, TARIFF_CSV_COLUMNS } from '@/lib/smartUtility/tariffAdmin';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST {csv, dryRun} — spreadsheet (CSV) tariff import. A dry run validates every row and returns what would be
 * created. A real import saves nothing unless every row is valid.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, tariffImportSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const { data: units } = await auth.supabase.from('units').select('id, unit_label').eq('property_id', property.id);
  const byLabel = new Map((units ?? []).map((u) => [String(u.unit_label).toLowerCase(), u.id as string]));
  const { rows, headerError } = parseTariffCsv(parsed.data.csv, byLabel);
  if (headerError) return jsonError(400, 'invalid_csv', headerError, { columns: TARIFF_CSV_COLUMNS });
  if (rows.length === 0) return jsonError(400, 'invalid_csv', 'No tariff rows found.');
  if (rows.length > 100) return jsonError(400, 'invalid_csv', 'At most 100 tariffs per import.');
  const summary = rows.map((r) => ({
    line: r.line,
    ok: r.ok,
    errors: r.errors,
    name: r.tariff?.name ?? null,
    utilityType: r.tariff?.utilityType ?? null,
    effectiveFrom: r.tariff?.effectiveFrom ?? null,
  }));
  const invalid = rows.filter((r) => !r.ok).length;
  if (parsed.data.dryRun || invalid > 0) {
    return NextResponse.json(
      { dryRun: true, valid: rows.length - invalid, invalid, rows: summary },
      { status: invalid > 0 && !parsed.data.dryRun ? 422 : 200 },
    );
  }
  try {
    // Oldest first so each version closes its predecessor correctly.
    const ordered = [...rows].sort((a, b) => a.tariff!.effectiveFrom.localeCompare(b.tariff!.effectiveFrom));
    const ids: string[] = [];
    for (const r of ordered) ids.push(await createTariff(auth.supabase, r.tariff!, property.org_id, property.id, auth.user.id));
    return NextResponse.json({ dryRun: false, created: ids.length, tariffIds: ids, rows: summary }, { status: 201 });
  } catch (error) {
    return serverError('tariff_import_failed', 'Some tariffs could not be saved; check the tariff list before retrying.', 'utility_tariffs.import', error);
  }
}
