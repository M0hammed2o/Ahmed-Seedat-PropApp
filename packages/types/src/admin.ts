import type { AdminRole } from './enums';

export interface AdminUser {
  id: string;
  authUserId: string;
  role: AdminRole;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Shape matches DATABASE.md §10 (post-TD-14 cutover, migration 20260101000043), extended by the
// staff security + audit hardening pass (migration 20260101000125) with propertyId/actorRole/
// actorDisplayName/correlationId.
export interface AuditEvent {
  id: string;
  orgId: string | null; // null only for platform-level events with no org context
  actorUserId: string | null; // null for system-generated events
  actorType: 'user' | 'system' | 'api' | 'ai_assisted';
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ipAddress: string | null;
  aiConversationId: string | null;
  aiMessageId: string | null;
  propertyId: string | null;
  /** Snapshot of the actor's org role AT THE TIME of the action -- never re-derived from their
   *  current role, which may have since changed. Null for system/api/ai_assisted actors, or when
   *  never resolved. */
  actorRole: string | null;
  /** Snapshot of the actor's display name AT THE TIME of the action, for the same reason as
   *  actorRole. Null when never resolved -- callers should fall back to a live lookup or a
   *  generic label, never a raw UUID. */
  actorDisplayName: string | null;
  correlationId: string | null;
  createdAt: string;
}
