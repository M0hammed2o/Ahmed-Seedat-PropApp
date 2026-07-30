import { z } from 'zod';
import { ORGANIZATION_TYPES, ORGANIZATION_MEMBER_ROLES } from '@propvault/types';

export const createOrganizationSchema = z.object({
  legalName: z.string().min(1, 'Legal name is required').max(200),
  orgType: z.enum(ORGANIZATION_TYPES).default('owner_managed'),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const createOrganizationInviteSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  role: z.enum(ORGANIZATION_MEMBER_ROLES).default('agent'),
});
export type CreateOrganizationInviteInput = z.infer<typeof createOrganizationInviteSchema>;
