import 'server-only';
import type { Organization } from '@propvault/types';

// Row-mapping helper for GET/PATCH /api/v1/organizations/:orgId (PWA_V1_COMPLETION_PLAN.md #8) --
// same snake_case-row -> camelCase-domain-type convention as lib/portfolio.ts's mapPropertyRow
// etc. No full-Organization mapping existed anywhere before this (create_organization() and
// resolvePortalSession() both only ever needed a subset of columns).

interface OrganizationRow {
  id: string;
  legal_name: string;
  trading_name: string | null;
  org_type: string;
  cipc_reg_no: string | null;
  vat_no: string | null;
  sars_tax_no: string | null;
  popia_information_officer: string | null;
  invoice_prefix: string;
  deposit_interest_pct: number;
  ffc_number: string | null;
  ffc_issued: string | null;
  ffc_expires: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function mapOrganizationRow(row: OrganizationRow): Organization {
  return {
    id: row.id,
    legalName: row.legal_name,
    tradingName: row.trading_name,
    orgType: row.org_type as Organization['orgType'],
    cipcRegNo: row.cipc_reg_no,
    vatNo: row.vat_no,
    sarsTaxNo: row.sars_tax_no,
    popiaInformationOfficer: row.popia_information_officer,
    invoicePrefix: row.invoice_prefix,
    depositInterestPct: row.deposit_interest_pct,
    ffcNumber: row.ffc_number,
    ffcIssued: row.ffc_issued,
    ffcExpires: row.ffc_expires,
    status: row.status as Organization['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
