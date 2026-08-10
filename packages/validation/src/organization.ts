import { z } from 'zod';
import {
  ORGANIZATION_TYPES,
  ORGANIZATION_MEMBER_ROLES,
  PROPERTY_ACCESS_MODES,
  STAFF_PROPERTY_ROLES,
} from '@propvault/types';

export const createOrganizationSchema = z.object({
  legalName: z.string().min(1, 'Legal name is required').max(200),
  orgType: z.enum(ORGANIZATION_TYPES).default('owner_managed'),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

// Owner + staff access completion pass (WORKLOG.md this date): propertyAccessMode/
// selectedProperties are optional and default to the pre-existing 'all' behaviour, so this stays
// backward compatible with any other caller of this schema. selectedProperties is only meaningful
// (and only applied server-side) when propertyAccessMode === 'selected'.
export const createOrganizationInviteSchema = z.object({
  name: z.string().max(200).optional().nullable(),
  email: z.string().email('Enter a valid email address'),
  role: z.enum(ORGANIZATION_MEMBER_ROLES).default('agent'),
  propertyAccessMode: z.enum(PROPERTY_ACCESS_MODES).default('all'),
  selectedProperties: z
    .array(
      z.object({
        propertyId: z.string().uuid(),
        propertyRole: z.enum(STAFF_PROPERTY_ROLES).default('read_only'),
      }),
    )
    .max(500)
    .default([]),
});
export type CreateOrganizationInviteInput = z.infer<typeof createOrganizationInviteSchema>;

// PATCH /api/v1/organizations/:orgId (PWA_V1_COMPLETION_PLAN.md #8) -- every organizations column
// that is actual org configuration, matching PERMISSIONS.md's "Organisation settings" row
// (manager+ full, agent/accountant/viewer view-only). Excludes `status` (Super Admin-only,
// SUPER_ADMIN.md §4 suspend/archive actions) and `org_type` (fixed at creation, no product
// decision anywhere says it's ever changed after the fact).
export const organizationUpdateSchema = z.object({
  legalName: z.string().min(1, 'Legal name is required').max(200).optional(),
  tradingName: z.string().max(200).optional().nullable(),
  cipcRegNo: z.string().max(60).optional().nullable(),
  vatNo: z.string().max(60).optional().nullable(),
  sarsTaxNo: z.string().max(60).optional().nullable(),
  popiaInformationOfficer: z.string().max(200).optional().nullable(),
  invoicePrefix: z.string().min(1).max(10).optional(),
  depositInterestPct: z.number().min(0).max(100).optional(),
  ffcNumber: z.string().max(60).optional().nullable(),
  ffcIssued: z.string().optional().nullable(),
  ffcExpires: z.string().optional().nullable(),
});
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>;
