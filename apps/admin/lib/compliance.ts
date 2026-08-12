import 'server-only';
import type {
  ComplianceAcknowledgement,
  ComplianceRequirement,
  LeaseOccupant,
  LevyStatement,
  LevyStatementLineItem,
  PropertyManagementContact,
  PropertyRule,
  PropertyRuleVersion,
} from '@propvault/types';

// Row-mapping helpers (snake_case DB row -> camelCase domain type), same convention
// lib/portfolio.ts/lib/tenantInvitations.ts already established.

export function mapPropertyRuleRow(row: Record<string, unknown>): PropertyRule {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    propertyId: row.property_id as string,
    category: row.category as PropertyRule['category'],
    title: row.title as string,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapPropertyRuleVersionRow(row: Record<string, unknown>): PropertyRuleVersion {
  return {
    id: row.id as string,
    ruleId: row.rule_id as string,
    orgId: row.org_id as string,
    documentId: row.document_id as string,
    versionNumber: row.version_number as number,
    status: row.status as PropertyRuleVersion['status'],
    effectiveDate: row.effective_date as string,
    expiryDate: (row.expiry_date as string | null) ?? null,
    acknowledgementRequired: row.acknowledgement_required as boolean,
    supersededBy: (row.superseded_by as string | null) ?? null,
    activatedAt: (row.activated_at as string | null) ?? null,
    supersededAt: (row.superseded_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function mapComplianceRequirementRow(row: Record<string, unknown>): ComplianceRequirement {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    propertyId: row.property_id as string,
    ruleVersionId: row.rule_version_id as string,
    tenantId: row.tenant_id as string,
    leaseId: (row.lease_id as string | null) ?? null,
    status: row.status as ComplianceRequirement['status'],
    assignedAt: row.assigned_at as string,
    dueAt: (row.due_at as string | null) ?? null,
    viewedAt: (row.viewed_at as string | null) ?? null,
    acknowledgedAt: (row.acknowledged_at as string | null) ?? null,
    waivedAt: (row.waived_at as string | null) ?? null,
    waivedBy: (row.waived_by as string | null) ?? null,
    waivedReason: (row.waived_reason as string | null) ?? null,
    supersededAt: (row.superseded_at as string | null) ?? null,
  };
}

export function mapComplianceAcknowledgementRow(
  row: Record<string, unknown>,
): ComplianceAcknowledgement {
  return {
    id: row.id as string,
    requirementId: row.requirement_id as string,
    ruleVersionId: row.rule_version_id as string,
    tenantId: row.tenant_id as string,
    userId: row.user_id as string,
    acknowledgedAt: row.acknowledged_at as string,
    acceptanceStatement: row.acceptance_statement as string,
    acceptanceMethod: row.acceptance_method as string,
    documentChecksum: row.document_checksum as string,
  };
}

export function mapLeaseOccupantRow(row: Record<string, unknown>): LeaseOccupant {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    leaseId: row.lease_id as string,
    fullName: row.full_name as string,
    occupantType: row.occupant_type as LeaseOccupant['occupantType'],
    relationship: (row.relationship as string | null) ?? null,
    moveInDate: (row.move_in_date as string | null) ?? null,
    moveOutDate: (row.move_out_date as string | null) ?? null,
    isActive: row.is_active as boolean,
    contactPhone: (row.contact_phone as string | null) ?? null,
    contactEmail: (row.contact_email as string | null) ?? null,
    complianceApplicable: row.compliance_applicable as boolean,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapPropertyManagementContactRow(
  row: Record<string, unknown>,
): PropertyManagementContact {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    propertyId: row.property_id as string,
    contactType: row.contact_type as PropertyManagementContact['contactType'],
    name: row.name as string,
    companyName: (row.company_name as string | null) ?? null,
    registrationNumber: (row.registration_number as string | null) ?? null,
    contactPerson: (row.contact_person as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    emergencyPhone: (row.emergency_phone as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    accountReference: (row.account_reference as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapLevyStatementRow(row: Record<string, unknown>): LevyStatement {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    propertyId: row.property_id as string,
    documentId: row.document_id as string,
    managementContactId: (row.management_contact_id as string | null) ?? null,
    statementDate: (row.statement_date as string | null) ?? null,
    periodStart: (row.period_start as string | null) ?? null,
    periodEnd: (row.period_end as string | null) ?? null,
    openingBalance: row.opening_balance === null ? null : Number(row.opening_balance),
    closingBalance: row.closing_balance === null ? null : Number(row.closing_balance),
    paymentDueDate: (row.payment_due_date as string | null) ?? null,
    paymentReference: (row.payment_reference as string | null) ?? null,
    status: row.status as LevyStatement['status'],
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapLevyStatementLineItemRow(row: Record<string, unknown>): LevyStatementLineItem {
  return {
    id: row.id as string,
    statementId: row.statement_id as string,
    lineType: row.line_type as LevyStatementLineItem['lineType'],
    category: row.category as string,
    description: (row.description as string | null) ?? null,
    amount: Number(row.amount),
    source: row.source as LevyStatementLineItem['source'],
    confidence: row.confidence === null ? null : Number(row.confidence),
    sortOrder: row.sort_order as number,
  };
}
