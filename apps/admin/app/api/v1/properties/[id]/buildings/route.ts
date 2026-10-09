import { NextResponse, type NextRequest } from 'next/server';
import { buildingCreateSchema } from '@propvault/validation';
import {
  canWriteUtilities,
  forbidden,
  jsonError,
  loadReadableProperty,
  notFound,
  parseJson,
  requireUser,
  serverError,
} from '@/lib/smartUtility/http';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/properties/:id/buildings -- optional building/block level (migration 175). */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, buildingCreateSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const { data, error } = await auth.supabase
    .from('property_buildings')
    .insert({ org_id: property.org_id, property_id: property.id, name: parsed.data.name })
    .select('id, name')
    .single();
  if (error) {
    if (error.code === '23505') return jsonError(409, 'duplicate_building', 'A building with that name already exists.');
    return serverError('building_create_failed', 'Could not add the building.', 'buildings.insert', error);
  }
  return NextResponse.json({ building: data }, { status: 201 });
}
