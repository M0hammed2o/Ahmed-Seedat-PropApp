import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { isValidStagedEndpoint, mapAiMessageRow } from '@/lib/ai';

type RouteParams = { params: Promise<{ id: string }> };

// Final pre-UAT engineering pass (WORKLOG.md this date), Part 6/7: V1 is READ-ONLY. This route's
// write-staging capability (AI_ARCHITECTURE.md §1.6) is explicitly disabled -- not merely
// unreachable because MockLLMProvider no longer emits a stagedChange (lib/providers/llm.ts),
// but refused HERE too, as defense in depth: a future real LLM provider swap must not silently
// re-enable AI-driven writes just by returning a stagedChange, and this pass's own hard
// requirement is an explicit, auditable "no" regardless of what any provider produces.
const AI_WRITES_ENABLED = false;

/**
 * POST /api/v1/ai/messages/:id/confirm (API_SPEC.md §9, AI_ARCHITECTURE.md §1.6). When
 * AI_WRITES_ENABLED flips true in a future, deliberately-scoped pass, this applies a staged
 * change by re-entering the exact typed endpoint it staged, as the acting user's own session --
 * never a privileged shortcut. "Re-enter in-process" is realized here as a same-origin fetch
 * forwarding the caller's own session cookie, so the target route resolves the identical
 * `auth.uid()`/role via its own `getServerSupabaseClient()` call and enforces the exact same Zod
 * validation and PERMISSIONS.md role check a human hitting that endpoint directly would face
 * (§1.6's "no shortcut path" requirement) -- a viewer-role user's staged write still 403s here
 * exactly as it would through the UI.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: messageId } = await params;
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

  if (!AI_WRITES_ENABLED) {
    return NextResponse.json(
      {
        error: {
          code: 'ai_writes_disabled',
          message:
            'The Proplyst Assistant cannot make changes on your behalf in this release -- it can only answer questions.',
        },
      },
      { status: 403 },
    );
  }

  const { data: message, error: messageError } = await supabase
    .from('ai_messages')
    .select('*')
    .eq('id', messageId)
    .maybeSingle();
  if (messageError) {
    return NextResponse.json(
      { error: { code: 'message_fetch_failed', message: messageError.message } },
      { status: 500 },
    );
  }
  if (!message) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Message not found.' } },
      { status: 404 },
    );
  }
  if (message.confirmed) {
    return NextResponse.json(
      {
        error: {
          code: 'already_confirmed',
          message: 'This staged change has already been confirmed.',
        },
      },
      { status: 409 },
    );
  }
  const stagedChange = message.staged_changes as {
    endpoint: string;
    method: string;
    body: Record<string, unknown>;
  } | null;
  if (!stagedChange) {
    return NextResponse.json(
      {
        error: {
          code: 'no_staged_change',
          message: 'This message has no staged change to confirm.',
        },
      },
      { status: 400 },
    );
  }
  if (!isValidStagedEndpoint(stagedChange.endpoint)) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_staged_endpoint',
          message: 'This staged change targets an unrecognized endpoint.',
        },
      },
      { status: 400 },
    );
  }

  const cookieHeader = request.headers.get('cookie') ?? '';
  const targetUrl = new URL(stagedChange.endpoint, request.nextUrl.origin);
  const targetResponse = await fetch(targetUrl, {
    method: stagedChange.method,
    headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
    body: JSON.stringify(stagedChange.body),
  });
  const targetBody = await targetResponse.json().catch(() => ({}));

  if (!targetResponse.ok) {
    return NextResponse.json(targetBody, { status: targetResponse.status });
  }

  const { data: updated, error: updateError } = await supabase
    .from('ai_messages')
    .update({ confirmed: true })
    .eq('id', messageId)
    .select('*')
    .single();
  if (updateError) {
    return NextResponse.json(
      { error: { code: 'confirm_update_failed', message: updateError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ message: mapAiMessageRow(updated), result: targetBody });
}
