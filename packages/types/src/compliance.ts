// Property rules / occupant compliance / body corporate / managing agent / levy statement
// workflow (WORKLOG.md this date). Mirrors the DB shapes added by migration
// 20260101000097_property_compliance_and_levy_statements.sql.

export const COMPLIANCE_DOCUMENT_CATEGORIES = [
  'conduct_rules',
  'body_corporate_rules',
  'estate_rules',
  'house_rules',
  'csos_rules',
  'welcome_pack',
  'rule_amendment',
  'occupant_policy',
  'other_compliance_document',
] as const;
export type ComplianceDocumentCategory = (typeof COMPLIANCE_DOCUMENT_CATEGORIES)[number];

export type PropertyRuleVersionStatus = 'draft' | 'active' | 'superseded' | 'archived';

export type ComplianceRequirementStatus =
  'pending' | 'viewed' | 'acknowledged' | 'waived' | 'superseded';

export interface PropertyRule {
  id: string;
  orgId: string;
  propertyId: string;
  category: ComplianceDocumentCategory;
  title: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyRuleVersion {
  id: string;
  ruleId: string;
  orgId: string;
  documentId: string;
  versionNumber: number;
  status: PropertyRuleVersionStatus;
  effectiveDate: string;
  expiryDate: string | null;
  acknowledgementRequired: boolean;
  supersededBy: string | null;
  activatedAt: string | null;
  supersededAt: string | null;
  createdAt: string;
}

export interface ComplianceRequirement {
  id: string;
  orgId: string;
  propertyId: string;
  ruleVersionId: string;
  tenantId: string;
  leaseId: string | null;
  status: ComplianceRequirementStatus;
  assignedAt: string;
  dueAt: string | null;
  viewedAt: string | null;
  acknowledgedAt: string | null;
  waivedAt: string | null;
  waivedBy: string | null;
  waivedReason: string | null;
  supersededAt: string | null;
}

export interface ComplianceAcknowledgement {
  id: string;
  requirementId: string;
  ruleVersionId: string;
  tenantId: string;
  userId: string;
  acknowledgedAt: string;
  acceptanceStatement: string;
  acceptanceMethod: string;
  documentChecksum: string;
}

export const LEASE_OCCUPANT_TYPES = [
  'spouse_partner',
  'child_dependant',
  'other_approved_occupant',
] as const;
export type LeaseOccupantType = (typeof LEASE_OCCUPANT_TYPES)[number];

export interface LeaseOccupant {
  id: string;
  orgId: string;
  leaseId: string;
  fullName: string;
  occupantType: LeaseOccupantType;
  relationship: string | null;
  moveInDate: string | null;
  moveOutDate: string | null;
  isActive: boolean;
  contactPhone: string | null;
  contactEmail: string | null;
  complianceApplicable: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PROPERTY_MANAGEMENT_CONTACT_TYPES = [
  'body_corporate',
  'managing_agent',
  'hoa',
  'estate_management',
  'other',
] as const;
export type PropertyManagementContactType = (typeof PROPERTY_MANAGEMENT_CONTACT_TYPES)[number];

export interface PropertyManagementContact {
  id: string;
  orgId: string;
  propertyId: string;
  contactType: PropertyManagementContactType;
  name: string;
  companyName: string | null;
  registrationNumber: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  emergencyPhone: string | null;
  address: string | null;
  accountReference: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LevyStatementStatus = 'uploaded' | 'extracting' | 'extracted' | 'reviewed';
export type LevyStatementLineItemType = 'charge' | 'payment' | 'credit';
export type LevyStatementLineItemSource = 'ocr_heuristic' | 'manual';

export interface LevyStatement {
  id: string;
  orgId: string;
  propertyId: string;
  documentId: string;
  managementContactId: string | null;
  statementDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  paymentDueDate: string | null;
  paymentReference: string | null;
  status: LevyStatementStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LevyStatementLineItem {
  id: string;
  statementId: string;
  lineType: LevyStatementLineItemType;
  category: string;
  description: string | null;
  amount: number;
  source: LevyStatementLineItemSource;
  confidence: number | null;
  sortOrder: number;
}
