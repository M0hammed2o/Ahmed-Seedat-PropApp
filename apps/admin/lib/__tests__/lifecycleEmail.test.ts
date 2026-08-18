import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sendWelcomeEmailOnce } from '../lifecycleEmail';

// Production signup/onboarding (WORKLOG.md this date). Pins the exactly-once claim-then-send
// contract: the real bug this guards against is a check-then-send race (two concurrent callers
// both see "not sent yet" and both call the provider) -- these tests exercise the decision table
// around the claim, not a real database, so the race itself is proven by the unique-index
// migration + the E2E "callback retry does not duplicate it" coverage instead.

const mockSend = vi.fn();
vi.mock('../providers/email', () => ({
  getEmailProvider: () => ({ send: mockSend }),
}));

function buildServiceClient(opts: {
  claimedId: string | null;
  claimError?: { message: string };
  email?: string | null;
}) {
  const updateCalls: unknown[] = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe('user_lifecycle_events');
      return {
        upsert: () => ({
          select: () =>
            Promise.resolve({
              data: opts.claimedId ? [{ id: opts.claimedId }] : [],
              error: opts.claimError ?? null,
            }),
        }),
        update: (payload: unknown) => {
          updateCalls.push(payload);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
    auth: {
      admin: {
        getUserById: () =>
          Promise.resolve({
            data: {
              user:
                opts.email === undefined
                  ? { email: 'u@example.com' }
                  : opts.email
                    ? { email: opts.email }
                    : null,
            },
          }),
      },
    },
  };
  return { client, updateCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendWelcomeEmailOnce', () => {
  it('sends the email when this call wins the claim', async () => {
    const { client, updateCalls } = buildServiceClient({ claimedId: 'evt-1' });
    mockSend.mockResolvedValue({ providerMessageId: 'msg-1', status: 'queued' });

    await sendWelcomeEmailOnce(
      client as unknown as Parameters<typeof sendWelcomeEmailOnce>[0],
      'user-1',
      'Jane',
    );

    expect(mockSend).toHaveBeenCalledTimes(1);
    const sentInput = mockSend.mock.calls[0]![0];
    expect(sentInput.toAddress).toBe('u@example.com');
    expect(sentInput.subject).toContain('Welcome to');
    expect(sentInput.bodyText).toContain('Jane');
    // Final pre-UAT engineering pass (WORKLOG.md this date), Part 15: welcome_email now goes
    // through the shared branded HTML system, closing a real gap (this was the one template that
    // was previously plain-text-only).
    expect(typeof sentInput.bodyHtml).toBe('string');
    expect(sentInput.bodyHtml).toContain('Jane');
    expect(updateCalls.some((c) => (c as { status?: string }).status === 'sent')).toBe(true);
  });

  it('does not send when the claim is already held by an earlier call -- the exactly-once contract', async () => {
    const { client } = buildServiceClient({ claimedId: null }); // empty array = already claimed
    await sendWelcomeEmailOnce(
      client as unknown as Parameters<typeof sendWelcomeEmailOnce>[0],
      'user-1',
      'Jane',
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('falls back to a generic greeting when no first name is available yet (e.g. OAuth, before profile completion)', async () => {
    const { client } = buildServiceClient({ claimedId: 'evt-2' });
    mockSend.mockResolvedValue({ providerMessageId: 'msg-2', status: 'queued' });

    await sendWelcomeEmailOnce(
      client as unknown as Parameters<typeof sendWelcomeEmailOnce>[0],
      'user-1',
      null,
    );

    const sentInput = mockSend.mock.calls[0]![0];
    expect(sentInput.bodyText).toContain('Hi there,');
  });

  it('never throws when the provider send fails -- must not block account access', async () => {
    const { client, updateCalls } = buildServiceClient({ claimedId: 'evt-3' });
    mockSend.mockRejectedValue(new Error('provider down'));

    await expect(
      sendWelcomeEmailOnce(
        client as unknown as Parameters<typeof sendWelcomeEmailOnce>[0],
        'user-1',
        'Jane',
      ),
    ).resolves.toBeUndefined();
    expect(updateCalls.some((c) => (c as { status?: string }).status === 'failed')).toBe(true);
  });

  it('skips sending (no throw) when the account has no email address on file', async () => {
    const { client } = buildServiceClient({ claimedId: 'evt-4', email: null });
    await sendWelcomeEmailOnce(
      client as unknown as Parameters<typeof sendWelcomeEmailOnce>[0],
      'user-1',
      'Jane',
    );
    expect(mockSend).not.toHaveBeenCalled();
  });
});
