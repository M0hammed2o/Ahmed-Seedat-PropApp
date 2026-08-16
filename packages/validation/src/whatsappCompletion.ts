import { z } from 'zod';

// WhatsApp V1 completion pass (WORKLOG.md this date). Phase F (phone verification) + Phase A/B
// (payment reporting/confirmation) request schemas -- same convention every other route in this
// codebase uses (packages/validation), not inline validation.

const entityTypeSchema = z.enum(['tenant', 'owner', 'organization_member']);
const e164Schema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Must be a valid E.164 phone number (e.g. +27821234567)');

export const phoneVerificationRequestSchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().uuid('entityId must be a valid UUID'),
  phoneNumberE164: e164Schema,
});
export type PhoneVerificationRequestInput = z.infer<typeof phoneVerificationRequestSchema>;

export const phoneVerificationConfirmSchema = z.object({
  challengeId: z.string().uuid('challengeId must be a valid UUID'),
  otpCode: z.string().regex(/^\d{6}$/, 'otpCode must be a 6-digit code'),
});
export type PhoneVerificationConfirmInput = z.infer<typeof phoneVerificationConfirmSchema>;

export const phoneVerificationRevokeSchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().uuid('entityId must be a valid UUID'),
  phoneNumberE164: e164Schema,
});
export type PhoneVerificationRevokeInput = z.infer<typeof phoneVerificationRevokeSchema>;

export const paymentReportCreateSchema = z.object({
  propertyId: z.string().uuid('propertyId must be a valid UUID'),
  leaseId: z.string().uuid('leaseId must be a valid UUID'),
  rentScheduleId: z.string().uuid('rentScheduleId must be a valid UUID').optional().nullable(),
  amount: z.number().positive('amount must be positive'),
  paymentMethod: z.enum(['eft', 'cash', 'other']),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'paymentDate must be YYYY-MM-DD'),
  documentId: z.string().uuid('documentId must be a valid UUID').optional().nullable(),
});
export type PaymentReportCreateInput = z.infer<typeof paymentReportCreateSchema>;

export const paymentReportRejectSchema = z.object({
  reason: z.string().min(1, 'A rejection reason is required').max(500),
});
export type PaymentReportRejectInput = z.infer<typeof paymentReportRejectSchema>;
