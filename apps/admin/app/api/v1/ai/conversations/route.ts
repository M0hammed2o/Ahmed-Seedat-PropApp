import { NextResponse, type NextRequest } from 'next/server';
import { aiConversationCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapAiConversationRow } from '@/lib/ai';

/**
 * POST /api/v1/ai/conversations (API_SPEC.md §9, AI_ARCHITECTURE.md §1.3). Any org member
 * (viewer+) can start a conversation -- the Assistant carries no special permission of its own;
 * every write it eventually stages is authorized at confirm time by the real target endpoint's
 * own role check (§1.6).
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

  const isMember = await requireOrgRole(supabase, parsed.data.orgId, 'viewer');
  if (!isMember) {
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
