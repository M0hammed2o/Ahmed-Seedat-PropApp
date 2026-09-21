import { beforeEach, describe, expect, it, vi } from 'vitest';

// Account deletion is the endpoint Google Play's "App account deletion" policy rests on, and the
// one endpoint whose job is to destroy something. These tests pin the two properties that matter:
// it erases exactly what /delete-account and the privacy policy promise it erases, and it touches
// nothing else -- no invoice, payment, journal entry, tenant, property or organisation.
//
// Deliberately mock-based rather than run against a real Supabase: the behaviour being asserted is
// "which calls are made, against whose id, in what order", and a real run would have to create and
// then destroy a real auth identity to observe it.

const mockGetUser = vi.fn();
const mockSignOut = vi.fn(async () => ({ error: null }));
type AuthResult = { data: unknown; error: { message: string } | null };
const mockUpdateUserById = vi.fn(async (): Promise<AuthResult> => ({ data: {}, error: null }));
const mockRpc = vi.fn(async (): Promise<AuthResult> => ({ data: { identities_removed: 1 }, error: null }));
const mockWriteAuditEvent = vi.fn(async () => undefined);

/** Every public.<table> touched through the service-role client, in order. */
let tablesTouched: { table: string; op: string; payload: unknown; filterValue?: unknown }[] = [];
let memberUpdateError: unknown = null;

function serviceTable(table: string) {
  return {
    update(payload: unknown) {
      const record = { table, op: 'update', payload } as (typeof tablesTouched)[number];
      tablesTouched.push(record);
      return {
        eq(_column: string, value: unknown) {
          record.filterValue = value;
          return Promise.resolve({ error: table === 'organization_members' ? memberUpdateError : null });
        },
      };
    },
    delete() {
      tablesTouched.push({ table, op: 'delete', payload: null });
      return { eq: () => Promise.resolve({ error: null }) };
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabaseClient: async () => ({
    auth: { getUser: mockGetUser, signOut: mockSignOut },
  }),
  getServiceRoleClient: () => ({
    from: serviceTable,
    rpc: mockRpc,
    auth: { admin: { updateUserById: mockUpdateUserById } },
  }),
}));

vi.mock('@/lib/audit', () => ({ writeAuditEvent: mockWriteAuditEvent }));

const { POST } = await import('../route');

const CALLER = '11111111-2222-3333-4444-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  tablesTouched = [];
  memberUpdateError = null;
  mockGetUser.mockResolvedValue({ data: { user: { id: CALLER } } });
  mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
  mockRpc.mockResolvedValue({ data: { identities_removed: 1 }, error: null });
});

describe('POST /api/v1/account/delete', () => {
  it('refuses an unauthenticated caller', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST();

    expect(res.status).toBe(401);
    expect(tablesTouched).toEqual([]);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('takes no user id, so it can only ever delete the caller', async () => {
    // The handler's own signature is the guarantee: nothing about the request body or query can
    // redirect it at another person.
    expect(POST.length).toBe(0);

    await POST();

    expect(mockUpdateUserById).toHaveBeenCalledWith(CALLER, expect.anything());
    expect(mockRpc).toHaveBeenCalledWith('purge_deleted_account_auth_pii', { p_user_id: CALLER });
    const memberUpdate = tablesTouched.find((t) => t.table === 'organization_members');
    expect(memberUpdate?.filterValue).toBe(CALLER);
  });

  it('revokes organisation access, anonymises the address and permanently bans sign-in', async () => {
    const res = await POST();

    expect(res.status).toBe(200);
    expect(tablesTouched).toContainEqual(
      expect.objectContaining({
        table: 'organization_members',
        op: 'update',
        payload: { status: 'revoked' },
      }),
    );
    const [, attributes] = mockUpdateUserById.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(attributes.email).toBe(`deleted-${CALLER}@deleted.proplyst.invalid`);
    expect(attributes.ban_duration).toBeTruthy();
    // `.invalid` is reserved by RFC 2606 -- the rewritten address can never route anywhere.
    expect(String(attributes.email)).toMatch(/\.invalid$/);
  });

  it('no longer sends the metadata/phone fields that the Auth API silently ignored', async () => {
    // `user_metadata: {}` is merged by GoTrue (so it cleared nothing) and `phone: undefined` is
    // dropped by JSON.stringify (so it was never sent). Both are now the database function's job;
    // leaving them here would only imply a guarantee this call does not provide.
    await POST();

    const [, attributes] = mockUpdateUserById.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(attributes).not.toHaveProperty('user_metadata');
    expect(attributes).not.toHaveProperty('phone');
  });

  it('purges the identity records only after the account has been anonymised', async () => {
    // Order is a security property: the database function refuses to act on an account that has
    // not already been anonymised and banned, so calling it first would simply fail.
    const order: string[] = [];
    mockUpdateUserById.mockImplementation(async () => {
      order.push('anonymise');
      return { data: {}, error: null };
    });
    mockRpc.mockImplementation(async () => {
      order.push('purge');
      return { data: { identities_removed: 1 }, error: null };
    });

    await POST();

    expect(order).toEqual(['anonymise', 'purge']);
  });

  it('reports a failure to purge instead of claiming the account was deleted', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe('account_deletion_failed');
    expect(body).not.toHaveProperty('deleted');
  });

  it('retries a failing purge, because a banned caller cannot come back and finish it', async () => {
    // By the time the purge runs the account is already banned, so a caller whose access token has
    // expired can never retry. A transient blip must not be what strands an email address.
    let calls = 0;
    mockRpc.mockImplementation(async () => {
      calls += 1;
      return calls < 3
        ? { data: null, error: { message: 'transient' } }
        : { data: { identities_removed: 2 }, error: null };
    });

    const res = await POST();
    const body = await res.json();

    expect(calls).toBe(3);
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
  });

  it('leaves a findable record when the purge never succeeds, so it can be completed by hand', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'still down' } });

    await POST();

    // Three attempts, then a row an operator can search for -- the account is anonymised and
    // banned, which is exactly the state the function's guard requires, so it stays completable.
    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'account_deletion_purge_incomplete',
        entityId: CALLER,
      }),
    );
    // And it must not also claim the deletion completed.
    expect(mockWriteAuditEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'account_deleted' }),
    );
  });

  it('is safe to call twice -- every step is idempotent', async () => {
    const first = await POST();
    expect(first.status).toBe(200);

    // A second call (a double tap, or a retry after a dropped response) repeats the same writes
    // with the same values: revoke again, rename again, anonymise to the same address, purge an
    // already-purged account.
    mockRpc.mockResolvedValue({ data: { identities_removed: 0 }, error: null });
    const second = await POST();
    const body = await second.json();

    expect(second.status).toBe(200);
    expect(body.deleted).toBe(true);
    const written = [...new Set(tablesTouched.map((t) => t.table))].sort();
    expect(written).toEqual(['organization_members', 'profiles']);
  });

  it('stops if organisation access cannot be revoked, before touching the identity', async () => {
    memberUpdateError = { message: 'nope' };

    const res = await POST();

    expect(res.status).toBe(500);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('records the deletion without naming the person who is no longer identifiable', async () => {
    await POST();

    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'account_deleted',
        actorUserId: null,
        entityId: CALLER,
        orgId: null,
      }),
    );
  });

  it('ends the caller session and confirms what was and was not deleted', async () => {
    const res = await POST();
    const body = await res.json();

    expect(mockSignOut).toHaveBeenCalled();
    expect(body.deleted).toBe(true);
    expect(body.message).toMatch(/no longer sign in/i);
    expect(body.message).toMatch(/financial records are kept/i);
  });

  it('touches no business or financial record', async () => {
    await POST();

    // The only tables this endpoint may write are the two that hold the person's own access and
    // display name. Anything else appearing here means a business record was modified.
    const written = [...new Set(tablesTouched.map((t) => t.table))].sort();
    expect(written).toEqual(['organization_members', 'profiles']);

    for (const forbidden of [
      'invoices',
      'invoice_payments',
      'journal_entries',
      'payment_reports',
      'tenants',
      'properties',
      'organizations',
      'leases',
      'documents',
      'maintenance_tickets',
    ]) {
      expect(written).not.toContain(forbidden);
    }
    // Nothing is ever hard-deleted by this endpoint -- deletion is anonymisation in place.
    expect(tablesTouched.some((t) => t.op === 'delete')).toBe(false);
  });
});
