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

// Shape matches DATABASE.md §10 (post-TD-14 cutover, migration 20260101000043).
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
  createdAt: string;
}
