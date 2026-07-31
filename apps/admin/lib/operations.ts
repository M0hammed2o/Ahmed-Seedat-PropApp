import 'server-only';
import type { Inspection, InspectionItem, MaintenanceTicket, Vendor } from '@propvault/types';

// Operations-domain row mapping (apps/admin/app/api/v1/{maintenance-tickets,vendors,inspections}).

interface VendorRow {
  id: string;
  org_id: string;
  name: string;
  trade_category: string;
  phone: string | null;
  email: string | null;
  is_external: boolean;
  rating_avg: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function mapVendorRow(row: VendorRow): Vendor {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    tradeCategory: row.trade_category as Vendor['tradeCategory'],
    phone: row.phone,
    email: row.email,
    isExternal: row.is_external,
    ratingAvg: row.rating_avg,
    status: row.status as Vendor['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface MaintenanceTicketRow {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string | null;
  lease_id: string | null;
  tenant_id: string | null;
  submitted_by_user_id: string | null;
  submitted_by_tenant_id: string | null;
  summary: string;
  description: string | null;
  priority: string;
  status: string;
  assigned_vendor_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export function mapMaintenanceTicketRow(row: MaintenanceTicketRow): MaintenanceTicket {
  return {
    id: row.id,
    orgId: row.org_id,
    propertyId: row.property_id,
    unitId: row.unit_id,
    leaseId: row.lease_id,
    tenantId: row.tenant_id,
    submittedByUserId: row.submitted_by_user_id,
    submittedByTenantId: row.submitted_by_tenant_id,
    summary: row.summary,
    description: row.description,
    priority: row.priority as MaintenanceTicket['priority'],
    status: row.status as MaintenanceTicket['status'],
    assignedVendorId: row.assigned_vendor_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

// The kanban state machine API_SPEC.md §5 requires ("status transitions validated server-side").
// RLS can only express "is this caller agent+ in the org," not "is this a legal transition" -- the
// same category of API-layer-only check as requireOrgRole()'s finer invite-role rule (M4).
// pending_approval -> in_progress models a rejected approval going back for more work; completed
// is terminal, matching the inspections.status CHECK constraint's own "no further transitions
// once completed" spirit (that one's enforced in the DB because accounting depends on it; this
// one's a workflow convention, not a financial invariant, so it stays API-layer only).
const MAINTENANCE_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  to_do: new Set(['in_progress']),
  in_progress: new Set(['pending_approval', 'to_do']),
  pending_approval: new Set(['completed', 'in_progress']),
  completed: new Set([]),
};

export function isValidMaintenanceTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return MAINTENANCE_TRANSITIONS[from]?.has(to) ?? false;
}

interface InspectionRow {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string;
  lease_id: string | null;
  inspection_type: string;
  scheduled_at: string;
  status: string;
  landlord_signed_at: string | null;
  tenant_signed_at: string | null;
  tenant_refusal_reason: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapInspectionRow(row: InspectionRow): Inspection {
  return {
    id: row.id,
    orgId: row.org_id,
    propertyId: row.property_id,
    unitId: row.unit_id,
    leaseId: row.lease_id,
    inspectionType: row.inspection_type as Inspection['inspectionType'],
    scheduledAt: row.scheduled_at,
    status: row.status as Inspection['status'],
    landlordSignedAt: row.landlord_signed_at,
    tenantSignedAt: row.tenant_signed_at,
    tenantRefusalReason: row.tenant_refusal_reason,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface InspectionItemRow {
  id: string;
  inspection_id: string;
  room: string;
  item_description: string;
  condition_rating: string;
  notes: string | null;
  created_at: string;
}

export function mapInspectionItemRow(row: InspectionItemRow): InspectionItem {
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    room: row.room,
    itemDescription: row.item_description,
    conditionRating: row.condition_rating as InspectionItem['conditionRating'],
    notes: row.notes,
    createdAt: row.created_at,
  };
}
