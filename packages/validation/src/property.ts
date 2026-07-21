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
