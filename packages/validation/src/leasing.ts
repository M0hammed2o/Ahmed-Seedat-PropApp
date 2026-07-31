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

// Applications API (apps/admin/app/api/v1/applications/** -- API_SPEC.md §4, TASKS.md M9).
export const applicationCreateSchema = z.object({
  orgId: z.string().uuid('orgId must be a valid UUID'),
  propertyId: z.string().uuid('propertyId must be a valid UUID'),
  unitId: z.string().uuid('unitId must be a valid UUID'),
  applicantName: z.string().min(1, 'Applicant name is required').max(200),
  applicantEmail: z.string().email('Enter a valid email address').optional().nullable(),
  applicantPhone: z.string().max(30).optional().nullable(),
});
export type ApplicationCreateInput = z.infer<typeof applicationCreateSchema>;

// POST /api/v1/applications/:id/consent -- at least one of the two consent flags must be given;
// each is independently capturable (a POPIA consent can be given before screening consent, since
// screening is a distinct, later step in the evidenced flow).
export const applicationConsentSchema = z
  .object({
    popiaConsent: z.boolean().optional(),
    screeningConsent: z.boolean().optional(),
  })
  .refine((v) => v.popiaConsent !== undefined || v.screeningConsent !== undefined, {
    message: 'Provide at least one of popiaConsent or screeningConsent',
  });
export type ApplicationConsentInput = z.infer<typeof applicationConsentSchema>;

export const applicationDecisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('declined'),
    reason: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    decision: z.literal('approved'),
    rentAmount: z.number().positive('Rent amount must be greater than zero'),
    depositAmount: z.number().min(0).default(0),
    startDate: z.string().min(1, 'startDate is required (YYYY-MM-DD)'),
    endDate: z.string().optional().nullable(),
  }),
]);
export type ApplicationDecisionInput = z.infer<typeof applicationDecisionSchema>;

// Leases API (apps/admin/app/api/v1/leases/** -- API_SPEC.md §4, TASKS.md M10). Manual creation
// only -- `source` is always 'manual' here; 'application_approved' only ever comes from
// approve_application(), 'pdf_parsed' only from the not-yet-built upload-and-parse flow (M12).
export const leaseCreateSchema = z.object({
  orgId: z.string().uuid('orgId must be a valid UUID'),
  unitId: z.string().uuid('unitId must be a valid UUID'),
  startDate: z.string().min(1, 'startDate is required (YYYY-MM-DD)'),
  endDate: z.string().optional().nullable(),
  rentAmount: z.number().positive('Rent amount must be greater than zero'),
  depositAmount: z.number().min(0).default(0),
});
export type LeaseCreateInput = z.infer<typeof leaseCreateSchema>;

export const leaseUpdateSchema = z.object({
  startDate: z.string().min(1).optional(),
  endDate: z.string().optional().nullable(),
  rentAmount: z.number().positive().optional(),
  depositAmount: z.number().min(0).optional(),
  status: z.enum(['draft', 'active', 'expired', 'terminated']).optional(),
});
export type LeaseUpdateInput = z.infer<typeof leaseUpdateSchema>;
