import { z } from 'zod';
import { UNIT_STATUSES } from '@propvault/types';

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
