import { NextResponse, type NextRequest } from 'next/server';
import type { AssembledAssistantContext, ConversationTurn } from '@propvault/types';
import { aiMessageCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import {
  assembleOrgContext,
  assembleTenantContext,
  checkAiUsageCap,
  mapAiMessageRow,
} from '@/lib/ai';
import { getLLMProvider } from '@/lib/providers/llm';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { requireOrgRole } from '@/lib/portfolio';
import { resolveTenantSession } from '@/lib/tenantSession';

type RouteParams = { params: Promise<{ id: string }> };

// Final pre-UAT engineering pass (WORKLOG.md this date), Part 14: bounds how much conversation
// history is ever assembled into a turn -- an unbounded history (the prior version of this route
// had no .limit() at all) is both an unbounded read and, once a real token-metered LLM vendor is
// wired in, an unbounded cost per turn for a long-lived conversation.
const MAX_HISTORY_MESSAGES = 20;

/**
 * POST /api/v1/ai/conversations/:id/messages (API_SPEC.md §9, AI_ARCHITECTURE.md §1.4-1.7).
 * Returns the assistant's reply; NEVER applies a write directly (V1 is read-only -- see
 * lib/providers/llm.ts's own header comment). Uses only the acting user's own session-bound
 * client for every read/write on this path -- no service-role connection is ever opened on the
 * LLM's behalf (§1.4's hard requirement) -- except for the one `usage_events` metering insert at
 * the end, which (like every usage_events write in this codebase) has no client insert policy and
 * must go through service-role; it carries no context data, only a token count.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: conversationId } = await params;
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

  const rateLimited = await rateLimitOrRespond(supabase, `ai-message:${user.id}`, 30, 300);
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

  const parsed = aiMessageCreateSchema.safeParse(body);
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

  const { data: conversation, error: conversationError } = await supabase
    .from('ai_conversations')
    .select('id, org_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (conversationError) {
    return NextResponse.json(
      { error: { code: 'conversation_fetch_failed', message: conversationError.message } },
      { status: 500 },
    );
  }
  if (!conversation) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Conversation not found.' } },
      { status: 404 },
    );
  }

  const usageCap = await checkAiUsageCap(supabase, conversation.org_id);
  if (!usageCap.allowed) {
    return NextResponse.json(
      {
        error: {
          code: 'ai_usage_cap_exceeded',
          message: 'This organization has reached its AI usage cap for the current period.',
        },
      },
      { status: 429 },
    );
  }

  // Final pre-UAT engineering pass (WORKLOG.md this date), Part 7: the acting user's CURRENT,
  // server-resolved relationship to this conversation's own org_id decides which context gets
  // assembled -- never a client-supplied "I am a tenant" flag. Org-staff wins if the caller is
  // both (rare, but a staff member CAN also be a tenant elsewhere) since ai_conversations.org_id
  // was already established at creation time by requireOrgRole/tenant-membership in the
  // conversations route, and staff access is the superset the RLS policy checks first.
  const [isOrgMember, tenancyResult] = await Promise.all([
    requireOrgRole(supabase, conversation.org_id, 'viewer'),
    supabase
      .from('tenants')
      .select('id, org_id')
      .eq('org_id', conversation.org_id)
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);

  let context: AssembledAssistantContext;
  if (isOrgMember) {
    context = await assembleOrgContext(supabase, conversation.org_id);
  } else if (tenancyResult.data) {
    const tenantSession = await resolveTenantSession();
    if (!tenantSession || tenantSession.tenantId !== tenancyResult.data.id) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'You do not have access to this conversation.' } },
        { status: 403 },
      );
    }
    context = await assembleTenantContext(supabase, {
      tenantId: tenantSession.tenantId,
      orgId: tenantSession.orgId,
      leaseId: tenantSession.leaseId,
      propertyLabel: tenantSession.propertyNickname,
      unitLabel: tenantSession.unitLabel,
    });
  } else {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have access to this conversation.' } },
      { status: 403 },
    );
  }

  const historyResult = await supabase
    .from('ai_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);
  if (historyResult.error) {
    return NextResponse.json(
      { error: { code: 'history_fetch_failed', message: historyResult.error.message } },
      { status: 500 },
    );
  }
  const history: ConversationTurn[] = (historyResult.data ?? []).reverse().map((row) => ({
    role: row.role as ConversationTurn['role'],
    content: row.content as string,
  }));

  const { error: userMessageError } = await supabase
    .from('ai_messages')
    .insert({ conversation_id: conversationId, role: 'user', content: parsed.data.text });
  if (userMessageError) {
    return NextResponse.json(
      { error: { code: 'message_create_failed', message: userMessageError.message } },
      { status: 500 },
    );
  }

  const llmProvider = getLLMProvider();
  const result = await llmProvider.converse({ context, history, userMessage: parsed.data.text });

  const { data: assistantMessage, error: assistantMessageError } = await supabase
    .from('ai_messages')
    .insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: result.replyText,
      staged_changes: result.stagedChange ?? null,
    })
    .select('*')
    .single();
  if (assistantMessageError) {
    return NextResponse.json(
      { error: { code: 'message_create_failed', message: assistantMessageError.message } },
      { status: 500 },
    );
  }

  if (result.costMetadata) {
    const totalTokens = result.costMetadata.inputTokens + result.costMetadata.outputTokens;
    if (totalTokens > 0) {
      const serviceClient = getServiceRoleClient();
      const { error: usageError } = await serviceClient.from('usage_events').insert({
        org_id: conversation.org_id,
        usage_type: 'ai_token',
        quantity: totalTokens,
        related_entity_type: 'ai_conversation',
        related_entity_id: conversationId,
      });
      // A metering-write failure must not fail the user-visible chat turn that already
      // succeeded -- logged, not thrown, matching the "best-effort telemetry, not a correctness
      // path" treatment usage metering gets everywhere else in this codebase.
      if (usageError) console.error('[ai/messages] usage_events insert failed', usageError.message);
    }
  }

  return NextResponse.json({ message: mapAiMessageRow(assistantMessage) }, { status: 201 });
}
