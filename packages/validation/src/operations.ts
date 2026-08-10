import { z } from 'zod';
import {
  VENDOR_TRADE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  INSPECTION_TYPES,
} from '@propvault/types';

// Vendors API (apps/admin/app/api/v1/vendors -- API_SPEC.md §5, TASKS.md M13).
export const vendorSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  tradeCategory: z.enum(VENDOR_TRADE_CATEGORIES).default('other'),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email('Enter a valid email address').optional().nullable(),
  isExternal: z.boolean().default(true),
});
export type VendorInput = z.infer<typeof vendorSchema>;

export const vendorCreateSchema = vendorSchema.extend({
  orgId: z.string().uuid('orgId must be a valid UUID'),
});
export type VendorCreateInput = z.infer<typeof vendorCreateSchema>;

export const vendorUpdateSchema = vendorSchema.partial();
export type VendorUpdateInput = z.infer<typeof vendorUpdateSchema>;

// Maintenance tickets API (staff-submitted) -- apps/admin/app/api/v1/maintenance-tickets/route.ts.
// Tenant-submitted tickets use tenantMaintenanceTicketCreateSchema below instead (narrower --
// org/property/unit/lease/tenant context is derived server-side from the caller's own tenant
// session, never client-supplied, see apps/admin/app/api/v1/tenant-portal/maintenance-tickets/route.ts).
export const maintenanceTicketCreateSchema = z.object({
  orgId: z.string().uuid('orgId must be a valid UUID'),
  propertyId: z.string().uuid('propertyId must be a valid UUID'),
  unitId: z.string().uuid().optional().nullable(),
  leaseId: z.string().uuid().optional().nullable(),
  tenantId: z.string().uuid().optional().nullable(),
  summary: z.string().min(1, 'Summary is required').max(200),
  description: z.string().max(5000).optional().nullable(),
  priority: z.enum(MAINTENANCE_PRIORITIES).default('medium'),
});
export type MaintenanceTicketCreateInput = z.infer<typeof maintenanceTicketCreateSchema>;

// Status is validated as a state-machine transition server-side (apps/admin/lib/operations.ts'
// MAINTENANCE_TRANSITIONS), not just enum membership -- API_SPEC.md §5's explicit requirement.
export const maintenanceTicketUpdateSchema = z.object({
  summary: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  priority: z.enum(MAINTENANCE_PRIORITIES).optional(),
  // null means common area / property-wide; property_id itself never changes on edit (task brief:
  // "do not ask the user to re-select the property"), so there's no propertyId field here to
  // validate unitId against -- the server derives it from the existing row, and the
  // validate_maintenance_ticket_unit_trigger (20260101000087) enforces the match either way.
  unitId: z.string().uuid().optional().nullable(),
  assignedVendorId: z.string().uuid().optional().nullable(),
  status: z.enum(['to_do', 'in_progress', 'pending_approval', 'completed']).optional(),
});
export type MaintenanceTicketUpdateInput = z.infer<typeof maintenanceTicketUpdateSchema>;

// Tenant-portal maintenance ticket submission (V1 scope correction, 2026-08-01 -- DECISIONS.md).
// Deliberately just summary/description/priority: org_id/property_id/unit_id/lease_id/tenant_id
// are all derived server-side from the caller's own active lease, never accepted from the client
// (API_SPEC.md §0's "no endpoint accepts a client-supplied org_id/identity as authoritative" rule
// extended to a tenant submitting against their own lease).
export const tenantMaintenanceTicketCreateSchema = z.object({
  summary: z.string().min(1, 'Summary is required').max(200),
  description: z.string().max(5000).optional().nullable(),
  priority: z.enum(MAINTENANCE_PRIORITIES).default('medium'),
});
export type TenantMaintenanceTicketCreateInput = z.infer<
  typeof tenantMaintenanceTicketCreateSchema
>;

// Inspections API.
export const inspectionCreateSchema = z.object({
  orgId: z.string().uuid('orgId must be a valid UUID'),
  propertyId: z.string().uuid('propertyId must be a valid UUID'),
  unitId: z.string().uuid('unitId must be a valid UUID'),
  leaseId: z.string().uuid().optional().nullable(),
  inspectionType: z.enum(INSPECTION_TYPES).default('routine'),
  scheduledAt: z.string().min(1, 'scheduledAt is required (ISO timestamp)'),
});
export type InspectionCreateInput = z.infer<typeof inspectionCreateSchema>;

export const inspectionItemCreateSchema = z.object({
  room: z.string().min(1, 'Room is required').max(100),
  itemDescription: z.string().min(1, 'Item description is required').max(500),
  conditionRating: z.enum(['good', 'fair', 'poor', 'damaged']).default('good'),
  notes: z.string().max(2000).optional().nullable(),
});
export type InspectionItemCreateInput = z.infer<typeof inspectionItemCreateSchema>;

// POST /api/v1/inspections/:id/sign (API_SPEC.md §5: "landlord or tenant signature; refusal
// reason accepted in lieu of tenant signature"). Exactly one signer per call -- landlord and
// tenant sign independently, at different times, never in one request.
export const inspectionSignSchema = z.discriminatedUnion('signer', [
  z.object({ signer: z.literal('landlord') }),
  z.object({
    signer: z.literal('tenant'),
    refusalReason: z.string().max(2000).optional().nullable(),
  }),
]);
export type InspectionSignInput = z.infer<typeof inspectionSignSchema>;
