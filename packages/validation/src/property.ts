import { z } from 'zod';
import { PROPERTY_TYPES } from '@propvault/types';

export const propertySchema = z.object({
  nickname: z.string().min(1, 'Give this property a name').max(80),
  addressLine1: z.string().min(1, 'Address line 1 is required').max(200),
  addressLine2: z.string().max(200).optional().nullable(),
  suburb: z.string().max(120).optional().nullable(),
  city: z.string().min(1, 'City is required').max(120),
  province: z.string().max(120).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  country: z.string().min(1).max(2).default('ZA'), // ISO 3166-1 alpha-2, default South Africa
  propertyType: z.enum(PROPERTY_TYPES),
  municipalAccountNumber: z.string().max(60).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type PropertyInput = z.infer<typeof propertySchema>;

// API-layer schemas (apps/admin/app/api/v1/properties) — the mobile app writes properties
// directly against RLS-protected Supabase (propertyRepository.ts) using `propertySchema` above;
// these add the `orgId` field a web API create call must supply explicitly (API_SPEC.md §0: "No
// endpoint accepts a client-supplied org_id as authoritative" — it's still validated against the
// caller's actual membership server-side, never trusted outright, same as create_organization.ts).
export const propertyCreateSchema = propertySchema.extend({
  orgId: z.string().uuid('orgId must be a valid UUID'),
});
export type PropertyCreateInput = z.infer<typeof propertyCreateSchema>;

// Valuation is captured as its own, separate, optional action after a property already exists
// (a landlord/staff opinion entered when they have one, not a required creation-time field) --
// added to the update schema only, not propertyCreateSchema (UI_INTEGRATION_PLAN.md Lovable
// Portfolio Value card, 2026-08-04).
export const propertyUpdateSchema = propertySchema.partial().extend({
  estimatedValue: z.number().min(0, 'Estimated value cannot be negative').max(1_000_000_000).optional().nullable(),
  estimatedValueAsOf: z.string().date('Use YYYY-MM-DD').optional().nullable(),
});
export type PropertyUpdateInput = z.infer<typeof propertyUpdateSchema>;
