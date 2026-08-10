import { z } from 'zod';
import { UNIT_STATUSES, OWNER_TYPES, OWNER_INVITATION_DELIVERY_CHANNELS } from '@propvault/types';

// Units API (apps/admin/app/api/v1/properties/:propId/units, /api/v1/units/:id — API_SPEC.md §3,
// TASKS.md M6). propertyId/orgId are always taken from the URL/session, never from this body —
// same "never trust client-supplied scoping" rule as propertyCreateSchema.
export const unitSchema = z.object({
  unitLabel: z.string().min(1, 'Unit label is required').max(60),
  bedrooms: z.number().int().min(0).max(50).optional().nullable(),
  bathrooms: z.number().min(0).max(50).optional().nullable(),
  sizeSqm: z.number().positive().max(1_000_000).optional().nullable(),
  marketRent: z.number().min(0).optional().nullable(),
  status: z.enum(UNIT_STATUSES).optional(),
});
export type UnitInput = z.infer<typeof unitSchema>;

export const unitUpdateSchema = unitSchema.partial();
export type UnitUpdateInput = z.infer<typeof unitUpdateSchema>;

// Owners API (apps/admin/app/api/v1/owners, /api/v1/owners/:id — API_SPEC.md §3, TASKS.md M7).
// user_id/bankingRef/mandate fields are intentionally not writable through this schema yet:
// bankingRef points at a not-yet-built banking-details table and mandate dates are a real
// business workflow (owner onboarding), not mechanical CRUD fields — see PRODUCT_SPEC.md §5 and
// TECHNICAL_DEBT_REGISTER.md. This schema covers the bookkeeping-record fields DATABASE.md §3's
// `owners` table supports today.
export const ownerSchema = z.object({
  ownerType: z.enum(OWNER_TYPES).default('individual'),
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Enter a valid email address').optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
});
export type OwnerInput = z.infer<typeof ownerSchema>;

export const ownerCreateSchema = ownerSchema.extend({
  orgId: z.string().uuid('orgId must be a valid UUID'),
});
export type OwnerCreateInput = z.infer<typeof ownerCreateSchema>;

export const ownerUpdateSchema = ownerSchema.partial();
export type OwnerUpdateInput = z.infer<typeof ownerUpdateSchema>;

// property_owners attach (POST /api/v1/properties/:propId/owners — API_SPEC.md §3).
export const propertyOwnerAttachSchema = z.object({
  ownerId: z.string().uuid('ownerId must be a valid UUID'),
  ownershipPct: z.number().gt(0).lte(100),
});
export type PropertyOwnerAttachInput = z.infer<typeof propertyOwnerAttachSchema>;

// Shared-access architecture pass (WORKLOG.md this date) -- owner invitation, mirrors
// tenantInvitationCreateSchema's shape minus the short-code option (see OwnerInvitation's own
// comment for why owners never need one).
export const ownerInvitationCreateSchema = z.object({
  deliveryChannel: z.enum(OWNER_INVITATION_DELIVERY_CHANNELS),
});
export type OwnerInvitationCreateInput = z.infer<typeof ownerInvitationCreateSchema>;

export const ownerInvitationAcceptSchema = z.object({
  token: z.string().min(1, 'token is required'),
});
export type OwnerInvitationAcceptInput = z.infer<typeof ownerInvitationAcceptSchema>;
