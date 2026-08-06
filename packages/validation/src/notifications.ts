import { z } from 'zod';
import { NOTIFICATION_CATEGORIES } from '@propvault/types';

// Communication API (apps/admin/app/api/v1/{announcements,notifications,notification-preferences,
// device-push-tokens} -- API_SPEC.md §5/§8, TASKS.md M15).

export const announcementCreateSchema = z.object({
  orgId: z.string().uuid('orgId must be a valid UUID'),
  propertyId: z.string().uuid().optional().nullable(),
  title: z.string().min(1, 'Title is required').max(200),
  body: z.string().min(1, 'Body is required'),
  requiresAcknowledgement: z.boolean().default(false),
  expiresAt: z.string().optional().nullable(),
});
export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>;

// PATCH /api/v1/notification-preferences -- upserts one category's settings for the caller.
export const notificationPreferenceUpdateSchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES),
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
});
export type NotificationPreferenceUpdateInput = z.infer<typeof notificationPreferenceUpdateSchema>;

export const devicePushTokenCreateSchema = z.object({
  platform: z.enum(['ios', 'android']),
  token: z.string().min(1, 'token is required'),
});
export type DevicePushTokenCreateInput = z.infer<typeof devicePushTokenCreateSchema>;
