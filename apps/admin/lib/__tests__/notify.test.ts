import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyPropertyStaff, notifyUser } from '../notify';

// V1 launch-completion pass (WORKLOG.md this date): notifyPropertyStaff()/notifyUser() are the
// first real insert path for the `notifications` table -- these tests pin the recipient-
// resolution contract (org-role filter intersected with property_access, excludeUserId, org-wide
// events skip the property_access query entirely) and the fail-soft contract (a thrown/mocked
// write failure must never propagate to the caller), mirroring legalConsent.test.ts's mocking
// pattern for the same reason: these are called from request-handling routes and a cron job where
// a notification failure must never break the primary flow.

interface Chainable {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  then: (resolve: (value: unknown) => void) => void;
}

function makeSelectChain(result: unknown): Chainable {
  const chainable = {} as Chainable;
  chainable.select = vi.fn(() => chainable);
  chainable.eq = vi.fn(() => chainable);
  chainable.in = vi.fn(() => chainable);
  chainable.then = (resolve: (value: unknown) => void) => resolve(result);
  return chainable;
}

function createServiceClient(options: {
  members: Array<{ user_id: string }>;
  access: Array<{ user_id: string }>;
  membersError?: { message: string } | null;
  accessError?: { message: string } | null;
  insertError?: { message: string } | null;
}) {
  const insertedRows: Array<Record<string, unknown>> = [];
  const orgMembersChain = makeSelectChain({
    data: options.members,
    error: options.membersError ?? null,
  });
  const propertyAccessChain = makeSelectChain({
    data: options.access,
    error: options.accessError ?? null,
  });
  const notificationsInsert = vi.fn((rows: unknown) => {
    const rowArray = Array.isArray(rows) ? rows : [rows];
    insertedRows.push(...(rowArray as Array<Record<string, unknown>>));
    return Promise.resolve({ error: options.insertError ?? null });
  });

  const from = vi.fn((table: string) => {
    if (table === 'organization_members') return orgMembersChain;
    if (table === 'property_access') return propertyAccessChain;
    if (table === 'notifications') return { insert: notificationsInsert };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    client: { from } as unknown as SupabaseClient,
    insertedRows,
    orgMembersChain,
    propertyAccessChain,
    notificationsInsert,
  };
}

describe('notifyPropertyStaff', () => {
  it('resolves recipients as org-role-qualified members intersected with property_access', async () => {
    const { client, insertedRows, propertyAccessChain } = createServiceClient({
      members: [{ user_id: 'u1' }, { user_id: 'u2' }],
      // Only u1 actually holds a property_access grant on this property -- u2 is org-role
      // qualified but lacks access to this specific property and must be excluded.
      access: [{ user_id: 'u1' }],
    });

    await notifyPropertyStaff(client, {
      orgId: 'org1',
      propertyId: 'prop1',
      type: 'maintenance_ticket_created',
      title: 'New maintenance request',
      body: 'A tenant reported a leak',
      relatedEntityType: 'maintenance_ticket',
      relatedEntityId: 'ticket1',
    });

    expect(propertyAccessChain.eq).toHaveBeenCalledWith('property_id', 'prop1');
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      user_id: 'u1',
      type: 'maintenance_ticket_created',
      title: 'New maintenance request',
      related_entity_type: 'maintenance_ticket',
      related_entity_id: 'ticket1',
    });
  });

  it('queries the correct org-role tier for minRole, defaulting to agent+', async () => {
    const { client, orgMembersChain } = createServiceClient({
      members: [],
      access: [],
    });

    await notifyPropertyStaff(client, {
      orgId: 'org1',
      propertyId: null,
      type: 'rent_overdue',
      title: 'Rent overdue',
    });
    expect(orgMembersChain.in).toHaveBeenCalledWith('role', ['agent', 'manager', 'principal']);

    const { client: client2, orgMembersChain: chain2 } = createServiceClient({
      members: [],
      access: [],
    });
    await notifyPropertyStaff(client2, {
      orgId: 'org1',
      propertyId: null,
      type: 'rent_overdue',
      title: 'Rent overdue',
      minRole: 'manager',
    });
    expect(chain2.in).toHaveBeenCalledWith('role', ['manager', 'principal']);
  });

  it('skips the property_access query entirely for an org-wide event with no propertyId', async () => {
    const { client, insertedRows, propertyAccessChain } = createServiceClient({
      members: [{ user_id: 'u1' }, { user_id: 'u2' }],
      access: [],
    });

    await notifyPropertyStaff(client, {
      orgId: 'org1',
      type: 'rent_overdue',
      title: 'Rent overdue',
    });

    expect(propertyAccessChain.eq).not.toHaveBeenCalled();
    expect(insertedRows.map((r) => r.user_id).sort()).toEqual(['u1', 'u2']);
  });

  it('excludes excludeUserId from the recipient set even when they are otherwise qualified', async () => {
    const { client, insertedRows } = createServiceClient({
      members: [{ user_id: 'u1' }, { user_id: 'u2' }],
      access: [{ user_id: 'u1' }, { user_id: 'u2' }],
    });

    await notifyPropertyStaff(client, {
      orgId: 'org1',
      propertyId: 'prop1',
      type: 'maintenance_ticket_created',
      title: 'New maintenance request',
      excludeUserId: 'u1',
    });

    expect(insertedRows.map((r) => r.user_id)).toEqual(['u2']);
  });

  it('never throws when the recipient-resolution query errors', async () => {
    const { client, insertedRows } = createServiceClient({
      members: [],
      access: [],
      membersError: { message: 'db unavailable' },
    });

    await expect(
      notifyPropertyStaff(client, {
        orgId: 'org1',
        propertyId: 'prop1',
        type: 'maintenance_ticket_created',
        title: 'New maintenance request',
      }),
    ).resolves.toBeUndefined();
    expect(insertedRows).toHaveLength(0);
  });

  it('never throws when the notifications insert fails -- must not block the calling flow', async () => {
    const { client } = createServiceClient({
      members: [{ user_id: 'u1' }],
      access: [{ user_id: 'u1' }],
      insertError: { message: 'db unavailable' },
    });

    await expect(
      notifyPropertyStaff(client, {
        orgId: 'org1',
        propertyId: 'prop1',
        type: 'maintenance_ticket_created',
        title: 'New maintenance request',
      }),
    ).resolves.toBeUndefined();
  });

  it('makes no insert call when there are zero qualifying recipients', async () => {
    const { client, notificationsInsert } = createServiceClient({
      members: [{ user_id: 'u1' }],
      access: [], // u1 has no property_access grant on this property
    });

    await notifyPropertyStaff(client, {
      orgId: 'org1',
      propertyId: 'prop1',
      type: 'maintenance_ticket_created',
      title: 'New maintenance request',
    });

    expect(notificationsInsert).not.toHaveBeenCalled();
  });
});

describe('notifyUser', () => {
  it('inserts a single notification row for the given user', async () => {
    const { client, insertedRows } = createServiceClient({ members: [], access: [] });

    await notifyUser(client, {
      userId: 'tenant1',
      type: 'payment_awaiting_confirmation',
      title: 'Payment awaiting confirmation',
      body: 'R500 EFT reported',
      relatedEntityType: 'payment_report',
      relatedEntityId: 'pr1',
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      user_id: 'tenant1',
      type: 'payment_awaiting_confirmation',
      related_entity_id: 'pr1',
    });
  });

  it('never throws when the write fails', async () => {
    const { client } = createServiceClient({
      members: [],
      access: [],
      insertError: { message: 'db unavailable' },
    });

    await expect(
      notifyUser(client, { userId: 'tenant1', type: 'payment_awaiting_confirmation', title: 'x' }),
    ).resolves.toBeUndefined();
  });
});
