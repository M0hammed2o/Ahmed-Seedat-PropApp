import { z } from 'zod';
import {
  COMPLIANCE_DOCUMENT_CATEGORIES,
  LEASE_OCCUPANT_TYPES,
  PROPERTY_MANAGEMENT_CONTACT_TYPES,
} from '@propvault/types';

// Property rules / occupant compliance / body corporate / levy statement workflow (WORKLOG.md
// this date). Mirrors migration 20260101000097's RPC parameter shapes -- every write goes through
// a SECURITY DEFINER function (create_property_rule, create_property_rule_version,
// activate_property_rule_version, acknowledge_compliance_requirement,
// waive_compliance_requirement), never a raw table insert, so these schemas validate exactly what
// each RPC call needs.

export const propertyRuleCreateSchema = z.object({
  category: z.enum(COMPLIANCE_DOCUMENT_CATEGORIES),
  title: z.string().min(1, 'Title is required').max(200),
});
export type PropertyRuleCreateInput = z.infer<typeof propertyRuleCreateSchema>;

export const propertyRuleVersionCreateSchema = z
  .object({
    documentId: z.string().uuid('documentId must be a valid UUID'),
    effectiveDate: z.string().min(1, 'Effective date is required'),
    expiryDate: z.string().optional().nullable(),
    acknowledgementRequired: z.boolean().default(true),
  })
  .refine((v) => !v.expiryDate || v.expiryDate > v.effectiveDate, {
    message: 'Expiry date must be after the effective date',
    path: ['expiryDate'],
  });
export type PropertyRuleVersionCreateInput = z.infer<typeof propertyRuleVersionCreateSchema>;

// "I confirm that I have read and understand the rules applicable to my occupancy and agree to
// comply with them." style statement -- the exact wording is supplied by the client (rendered
// from the same copy the tenant actually saw) and snapshotted verbatim as evidence, never
// re-derived server-side, matching acceptedTermsVersion/acceptedPrivacyVersion's own "the box was
// checked against THIS exact text" pattern in registerSchema.
export const complianceAcknowledgeSchema = z.object({
  acceptanceStatement: z.string().min(1, 'An acceptance statement is required').max(2000),
});
export type ComplianceAcknowledgeInput = z.infer<typeof complianceAcknowledgeSchema>;

export const complianceWaiveSchema = z.object({
  reason: z.string().min(1, 'A reason is required').max(1000),
});
export type ComplianceWaiveInput = z.infer<typeof complianceWaiveSchema>;

export const leaseOccupantSchema = z.object({
  fullName: z.string().min(1, 'Full name is required').max(200),
  occupantType: z.enum(LEASE_OCCUPANT_TYPES),
  relationship: z.string().max(100).optional().nullable(),
  moveInDate: z.string().optional().nullable(),
  moveOutDate: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  contactPhone: z.string().max(30).optional().nullable(),
  contactEmail: z.string().email('Enter a valid email address').optional().nullable(),
  complianceApplicable: z.boolean().default(false),
  notes: z.string().max(1000).optional().nullable(),
});
export type LeaseOccupantInput = z.infer<typeof leaseOccupantSchema>;

export const propertyManagementContactSchema = z.object({
  contactType: z.enum(PROPERTY_MANAGEMENT_CONTACT_TYPES),
  name: z.string().min(1, 'Name is required').max(200),
  companyName: z.string().max(200).optional().nullable(),
  registrationNumber: z.string().max(100).optional().nullable(),
  contactPerson: z.string().max(200).optional().nullable(),
  email: z.string().email('Enter a valid email address').optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  emergencyPhone: z.string().max(30).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  accountReference: z.string().max(100).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});
export type PropertyManagementContactInput = z.infer<typeof propertyManagementContactSchema>;

export const levyStatementCreateSchema = z.object({
  documentId: z.string().uuid('documentId must be a valid UUID'),
  managementContactId: z.string().uuid().optional().nullable(),
});
export type LevyStatementCreateInput = z.infer<typeof levyStatementCreateSchema>;

export const levyStatementUpdateSchema = z.object({
  statementDate: z.string().optional().nullable(),
  periodStart: z.string().optional().nullable(),
  periodEnd: z.string().optional().nullable(),
  openingBalance: z.number().optional().nullable(),
  closingBalance: z.number().optional().nullable(),
  paymentDueDate: z.string().optional().nullable(),
  paymentReference: z.string().max(100).optional().nullable(),
});
export type LevyStatementUpdateInput = z.infer<typeof levyStatementUpdateSchema>;

export const levyStatementLineItemSchema = z.object({
  lineType: z.enum(['charge', 'payment', 'credit']),
  category: z.string().min(1, 'Category is required').max(100),
  description: z.string().max(500).optional().nullable(),
  amount: z.number(),
  sortOrder: z.number().int().default(0),
});
export type LevyStatementLineItemInput = z.infer<typeof levyStatementLineItemSchema>;
