import { z } from 'zod';

// Tenants API (apps/admin/app/api/v1/tenants, /api/v1/tenants/:id -- API_SPEC.md §4, TASKS.md
// M8). No `status`/`idNumberRef` field here: status defaults server-side ('pending', matching the
// DB column default) rather than being client-settable on create, and idNumberRef is a pointer
// into encrypted_secrets with no write path yet (TECHNICAL_DEBT_REGISTER.md -- the encryption
// pipeline isn't wired up, so there is nothing for a client to legitimately set this to).
export const tenantSchema = z.object({
  fullName: z.string().min(1, 'Full name is required').max(200),
  email: z.string().email('Enter a valid email address').optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
});
export type TenantInput = z.infer<typeof tenantSchema>;

export const tenantCreateSchema = tenantSchema.extend({
  orgId: z.string().uuid('orgId must be a valid UUID'),
});
export type TenantCreateInput = z.infer<typeof tenantCreateSchema>;

export const tenantUpdateSchema = tenantSchema.partial();
export type TenantUpdateInput = z.infer<typeof tenantUpdateSchema>;
