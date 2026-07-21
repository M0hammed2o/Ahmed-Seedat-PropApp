import { z } from 'zod';
import { ALLOWED_MIME_TYPES, DOCUMENT_TYPES } from '@propvault/types';

export const documentUploadMetadataSchema = z.object({
  propertyId: z.string().uuid(),
  categoryId: z.string().uuid(),
  documentType: z.enum(DOCUMENT_TYPES),
  billingYear: z.number().int().min(2000).max(2100).optional().nullable(),
  billingMonth: z.number().int().min(1).max(12).optional().nullable(),
  originalFileName: z.string().min(1).max(255),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  fileSizeBytes: z.number().int().positive(),
});
export type DocumentUploadMetadataInput = z.infer<typeof documentUploadMetadataSchema>;

export const billCorrectionSchema = z.object({
  supplierName: z.string().max(160).optional().nullable(),
  billingYear: z.number().int().min(2000).max(2100).optional().nullable(),
  billingMonth: z.number().int().min(1).max(12).optional().nullable(),
  statementDate: z.string().datetime().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  amountDue: z.number().nonnegative().optional().nullable(),
  accountNumber: z.string().max(80).optional().nullable(),
  invoiceNumber: z.string().max(80).optional().nullable(),
  paymentReference: z.string().max(80).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type BillCorrectionInput = z.infer<typeof billCorrectionSchema>;

export const paymentCorrectionSchema = z.object({
  recipientName: z.string().max(160).optional().nullable(),
  amount: z.number().nonnegative().optional().nullable(),
  paymentReference: z.string().max(80).optional().nullable(),
  paymentDate: z.string().datetime().optional().nullable(),
});
export type PaymentCorrectionInput = z.infer<typeof paymentCorrectionSchema>;
