import { NextResponse, type NextRequest } from 'next/server';
import { propertyRuleCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapPropertyRuleRow, mapPropertyRuleVersionRow } from '@/lib/compliance';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET/POST /api/v1/properties/:id/rules (property compliance workflow, WORKLOG.md this date).
 * agent+ to create (mirrors tenant-invitation's own floor -- rule management is a
 * tenant-management-adjacent action); viewer+ to list. GET returns each rule with its versions
 * nested, matching how the owner/staff compliance UI needs to render "Conduct Rules v2 --
 * ACTIVE / v1 -- superseded" in one shot without N+1 requests.
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
  if (!(await requireOrgRole(supabase, property.org_id, 'viewer'))) {
    return NextResponse.json(
      {
        error: { code: 'forbidden', message: 'You do not have permission to view this property.' },
      },
      { status: 403 },
    );
  }

  const { data: rules, error: rulesError } = await supabase
    .from('property_rules')
    .select('*, property_rule_versions(*)')
    .eq('property_id', id)
    .order('created_at', { ascending: false });
  if (rulesError) {
    return NextResponse.json(
      { error: { code: 'rules_fetch_failed', message: rulesError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    rules: (rules ?? []).map((row) => ({
      ...mapPropertyRuleRow(row),
      versions: ((row.property_rule_versions ?? []) as Record<string, unknown>[])
        .sort((a, b) => (b.version_number as number) - (a.version_number as number))
        .map(mapPropertyRuleVersionRow),
    })),
  });
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }
  const parsed = propertyRuleCreateSchema.safeParse(body);
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

  const { data: ruleId, error } = await supabase.rpc('create_property_rule', {
    p_property_id: id,
    p_category: parsed.data.category,
    p_title: parsed.data.title,
  });
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: /permission|agent/i.test(error.message) ? 'forbidden' : 'rule_create_failed',
          message: error.message,
        },
      },
      { status: /permission|agent/i.test(error.message) ? 403 : 500 },
    );
  }

  return NextResponse.json({ ruleId }, { status: 201 });
}
