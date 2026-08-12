import { NextResponse, type NextRequest } from 'next/server';
import { levyStatementCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapLevyStatementRow } from '@/lib/compliance';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET/POST /api/v1/properties/:id/levy-statements (PHASE 10). POST records a levy statement
 * against an already-uploaded `documents` row (upload happens through the existing document
 * upload path first) -- this route never touches storage. Financial data: agent+ to create,
 * viewer+ to list, matching levy_statements' own RLS floor exactly (no tenant access).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  const { data: statements, error } = await supabase
    .from('levy_statements')
    .select('*')
    .eq('property_id', id)
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: { code: 'levy_statements_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ statements: (statements ?? []).map(mapLevyStatementRow) });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  const { data: property } = await supabase
    .from('properties')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (!property) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Property not found.' } },
      { status: 404 },
    );
  }
  if (!(await requireOrgRole(supabase, property.org_id, 'agent'))) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to add a levy statement.',
        },
      },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }
  const parsed = levyStatementCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  // The supplied document must actually belong to this property (same defensive check
  // create_property_rule_version() does inside its own transaction).
  const { data: document } = await supabase
    .from('documents')
    .select('id')
    .eq('id', parsed.data.documentId)
    .eq('property_id', id)
    .maybeSingle();
  if (!document) {
    return NextResponse.json(
      { error: { code: 'document_not_found', message: 'Document not found for this property.' } },
      { status: 404 },
    );
  }

  const { data: statement, error } = await supabase
    .from('levy_statements')
    .insert({
      org_id: property.org_id,
      property_id: id,
      document_id: parsed.data.documentId,
      management_contact_id: parsed.data.managementContactId ?? null,
      created_by: user.id,
    })
    .select('*')
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'levy_statement_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ statement: mapLevyStatementRow(statement) }, { status: 201 });
}
