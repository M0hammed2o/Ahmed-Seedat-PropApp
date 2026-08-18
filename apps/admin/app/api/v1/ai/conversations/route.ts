import { NextResponse, type NextRequest } from 'next/server';
import { aiConversationCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapAiConversationRow } from '@/lib/ai';
import { rateLimitOrRespond } from '@/lib/rateLimit';

/**
 * POST /api/v1/ai/conversations (API_SPEC.md §9, AI_ARCHITECTURE.md §1.3). Any org member
 * (viewer+) OR any tenant with an active tenancy in this org can start a conversation -- the
 * Assistant carries no special permission of its own. `orgId` is never trusted blindly: it must
 * name an org the caller actually belongs to (as staff or as a tenant), re-checked here in
 * application code on top of the identical check ai_conversations' own RLS policy independently
 * enforces (20260101000109) -- "the model chooses an arbitrary org id" is not reachable even if
 * this check had a bug.
 *
 * Final pre-UAT engineering pass (WORKLOG.md this date), Part 14: rate-limited per caller --
 * starting a conversation is cheap but unbounded conversation creation would still be a real
 * abuse/cost vector once a real LLM vendor is wired in.
 */
export async function POST(request: NextRequest) {
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

  const rateLimited = await rateLimitOrRespond(
    supabase,
    `ai-conversation-create:${user.id}`,
    20,
    3600,
  );
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = aiConversationCreateSchema.safeParse(body);
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

  const isOrgMember = await requireOrgRole(supabase, parsed.data.orgId, 'viewer');
  let isTenant = false;
  if (!isOrgMember) {
    const { data: tenancy } = await supabase
      .from('tenants')
      .select('id')
      .eq('org_id', parsed.data.orgId)
      .eq('user_id', user.id)
      .maybeSingle();
    isTenant = tenancy !== null;
  }
  if (!isOrgMember && !isTenant) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You are not a member of this organization.' } },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('ai_conversations')
    .insert({ org_id: parsed.data.orgId, user_id: user.id })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'conversation_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ conversation: mapAiConversationRow(data) }, { status: 201 });
}
