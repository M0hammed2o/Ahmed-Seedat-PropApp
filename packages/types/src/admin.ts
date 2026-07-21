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

export interface AuditEvent {
  id: string;
  actorUserId: string | null; // null for system-generated events
  actorType: 'customer' | 'admin' | 'system';
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
