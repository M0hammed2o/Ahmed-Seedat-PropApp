import 'server-only';
import type { Announcement, AppNotification, DevicePushToken, NotificationPreference } from '@propvault/types';

// Communication-domain row mapping (apps/admin/app/api/v1/{announcements,notifications,
// notification-preferences,device-push-tokens}).

interface AnnouncementRow {
  id: string;
  org_id: string;
  property_id: string | null;
  title: string;
  body: string;
  requires_acknowledgement: boolean;
  published_at: string;
  expires_at: string | null;
  created_at: string;
}

export function mapAnnouncementRow(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    orgId: row.org_id,
    propertyId: row.property_id,
    title: row.title,
    body: row.body,
    requiresAcknowledgement: row.requires_acknowledgement,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export function mapNotificationRow(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

interface NotificationPreferenceRow {
  user_id: string;
  category: string;
  email_enabled: boolean;
  push_enabled: boolean;
  whatsapp_enabled: boolean;
}

export function mapNotificationPreferenceRow(row: NotificationPreferenceRow): NotificationPreference {
  return {
    userId: row.user_id,
    category: row.category as NotificationPreference['category'],
    emailEnabled: row.email_enabled,
    pushEnabled: row.push_enabled,
    whatsappEnabled: row.whatsapp_enabled,
  };
}

interface DevicePushTokenRow {
  id: string;
  user_id: string;
  platform: string;
  token: string;
  created_at: string;
  last_seen_at: string;
}

export function mapDevicePushTokenRow(row: DevicePushTokenRow): DevicePushToken {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform as DevicePushToken['platform'],
    token: row.token,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}
