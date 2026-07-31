import type { NotificationCategory, DevicePlatform } from './enums';

// Communication-domain types (DATABASE.md §7). TASKS.md M15.

export interface AppNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  userId: string;
  category: NotificationCategory;
  emailEnabled: boolean;
  pushEnabled: boolean;
  whatsappEnabled: boolean;
}

export interface DevicePushToken {
  id: string;
  userId: string;
  platform: DevicePlatform;
  token: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface Announcement {
  id: string;
  orgId: string;
  propertyId: string | null;
  title: string;
  body: string;
  requiresAcknowledgement: boolean;
  publishedAt: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface AnnouncementRead {
  announcementId: string;
  tenantId: string;
  readAt: string | null;
  acknowledgedAt: string | null;
}
