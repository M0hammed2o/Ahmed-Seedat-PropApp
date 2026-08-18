'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';

// Final pre-UAT engineering pass (WORKLOG.md this date), Part 13: the smallest useful V1 AI
// assistant UI -- a floating trigger + drawer, mounted once via AppShell's `assistant` slot so
// it's reachable from every page in a portal. Shared between the owner (dashboard) and tenant
// portals; `variant` only changes the label/suggested-question copy -- the backend
// (POST /api/v1/ai/conversations/:id/messages) already determines owner-vs-tenant context itself
// from the caller's real session, never from anything this component sends.
//
// READ-ONLY V1: there is no "confirm"/"apply" affordance anywhere in this component, because the
// backend never returns a stagedChange for this pass (lib/providers/llm.ts) -- nothing here needs
// to render one.

interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

const OWNER_SUGGESTIONS = [
  "What's overdue?",
  'Which payments are waiting for confirmation?',
  'Which leases expire soon?',
  'What should I pay attention to today?',
];

const TENANT_SUGGESTIONS = [
  'How much do I owe?',
  'When is my next rent due?',
  'Has my payment been confirmed?',
  'Are there any notices for me?',
];

export function AssistantDrawer({
  orgId,
  variant = 'owner',
}: {
  orgId: string;
  variant?: 'owner' | 'tenant';
}) {
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function ensureConversation(): Promise<string | null> {
    if (conversationId) return conversationId;
    try {
      const response = await fetch('/api/v1/ai/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not start a conversation with the assistant.');
        return null;
      }
      setConversationId(body.conversation.id);
      return body.conversation.id;
    } catch {
      setError('Could not reach the assistant -- check your connection and try again.');
      return null;
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setError(null);
    setSending(true);
    const conv = await ensureConversation();
    if (!conv) {
      setSending(false);
      return;
    }
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      },
    ]);
    setInput('');
    try {
      const response = await fetch(`/api/v1/ai/conversations/${conv}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(
          body.error?.code === 'ai_usage_cap_exceeded'
            ? 'This organization has reached its AI usage limit for this period.'
            : (body.error?.message ?? 'The assistant could not answer that -- try again.'),
        );
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: body.message.id,
          role: 'assistant',
          content: body.message.content,
          createdAt: body.message.createdAt,
        },
      ]);
    } catch {
      setError('Could not reach the assistant -- check your connection and try again.');
    } finally {
      setSending(false);
    }
  }

  const suggestions = variant === 'tenant' ? TENANT_SUGGESTIONS : OWNER_SUGGESTIONS;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Proplyst Assistant"
        className="fixed right-5 bottom-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lift transition-transform hover:scale-105"
      >
        <MessageCircle className="h-6 w-6" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="fixed right-5 bottom-5 z-40 flex h-[560px] w-[360px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lift">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Proplyst Assistant</p>
          <p className="text-[11px] text-muted-foreground">Answers from your own live data</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close Proplyst Assistant"
          className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Ask about your {variant === 'tenant' ? 'tenancy' : 'portfolio'} -- Proplyst answers
              only from your own real data, never a guess.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] text-foreground hover:bg-surface"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-surface text-foreground'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {sending ? (
          <div className="flex justify-start">
            <div className="rounded-xl bg-surface px-3 py-2 text-[13px] text-muted-foreground">
              Thinking…
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          maxLength={4000}
          disabled={sending}
          className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || input.trim().length === 0}
          aria-label="Send"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
