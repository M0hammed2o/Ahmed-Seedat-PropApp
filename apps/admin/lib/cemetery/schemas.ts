import { z } from 'zod';

// Request schemas shared by the cemetery API routes.

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const purchaserSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter the full name').max(200),
  phone: optionalText(40),
  email: z
    .union([z.literal(''), z.string().trim().email('Enter a valid e-mail address').max(254)])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  address: optionalText(500),
  nextOfKinName: optionalText(200),
  nextOfKinPhone: optionalText(40),
  nextOfKinRelationship: optionalText(80),
  notes: optionalText(2000),
});

export type PurchaserInput = z.infer<typeof purchaserSchema>;

export function purchaserRow(d: PurchaserInput) {
  return {
    full_name: d.fullName,
    phone: d.phone,
    email: d.email,
    address: d.address,
    next_of_kin_name: d.nextOfKinName,
    next_of_kin_phone: d.nextOfKinPhone,
    next_of_kin_relationship: d.nextOfKinRelationship,
    notes: d.notes,
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date (YYYY-MM-DD)');
const money = z.number().finite().min(0).max(100_000_000);
export const paymentMethod = z.enum(['eft', 'bank_transfer', 'card', 'cash', 'other']);

export const saleSchema = z
  .object({
    siteId: z.guid(),
    purchaserId: z.guid().optional().nullable(),
    newPurchaser: purchaserSchema.optional().nullable(),
    price: money.refine((v) => v > 0, 'The price must be greater than zero'),
    saleDate: isoDate,
    deposit: money.default(0),
    method: paymentMethod.default('eft'),
    reference: optionalText(120),
    notes: optionalText(2000),
  })
  .refine((d) => Boolean(d.purchaserId) !== Boolean(d.newPurchaser), {
    message: 'Choose an existing purchaser or enter a new one',
    path: ['purchaserId'],
  })
  .refine((d) => d.deposit <= d.price, {
    message: 'The deposit cannot be more than the price',
    path: ['deposit'],
  });

export const paymentSchema = z.object({
  amount: money.refine((v) => v > 0, 'The amount must be greater than zero'),
  paidOn: isoDate,
  method: paymentMethod,
  reference: optionalText(120),
  notes: optionalText(2000),
});

export const reservationSchema = z.object({
  purchaserId: z.guid(),
  reservedUntil: isoDate.optional().nullable(),
  notes: optionalText(500),
});

export const availabilitySchema = z.object({
  unavailable: z.boolean(),
  reason: optionalText(300),
});

export const burialSchema = z.object({
  deceasedFullName: z.string().trim().min(1, 'Enter the name of the deceased').max(200),
  dateOfBirth: isoDate.optional().nullable(),
  dateOfDeath: isoDate.optional().nullable(),
  burialDate: isoDate,
  burialOrderNumber: optionalText(60),
  funeralUndertaker: optionalText(200),
  notes: optionalText(2000),
});

export const siteUpdateSchema = z.object({
  notes: optionalText(2000),
  listPrice: money.optional().nullable(),
  lengthM: z.number().positive().max(100).optional().nullable(),
  widthM: z.number().positive().max(100).optional().nullable(),
  siteType: z.enum(['single', 'double', 'child', 'cremation']).optional(),
  maxInterments: z.number().int().min(1).max(10).optional(),
});

export const documentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  documentType: z.enum([
    'agreement',
    'title_deed',
    'burial_order',
    'death_certificate',
    'id_document',
    'correspondence',
    'other',
  ]),
  reference: optionalText(120),
  notes: optionalText(1000),
  saleId: z.guid().optional().nullable(),
});
