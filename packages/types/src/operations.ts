import type {
  MaintenancePriority,
  MaintenanceStatus,
  VendorTradeCategory,
  VendorStatus,
  VendorBillStatus,
  InspectionType,
  InspectionStatus,
  InspectionConditionRating,
} from './enums';

// Operations-domain types (DATABASE.md §5: Inspections & maintenance). TASKS.md M13.

export interface Vendor {
  id: string;
  orgId: string;
  name: string;
  tradeCategory: VendorTradeCategory;
  phone: string | null;
  email: string | null;
  isExternal: boolean;
  ratingAvg: number | null;
  status: VendorStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceTicket {
  id: string;
  orgId: string;
  propertyId: string;
  unitId: string | null;
  leaseId: string | null;
  tenantId: string | null;
  submittedByUserId: string | null;
  submittedByTenantId: string | null;
  summary: string;
  description: string | null;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  assignedVendorId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface VendorBill {
  id: string;
  orgId: string;
  vendorId: string;
  maintenanceTicketId: string | null;
  amount: number;
  status: VendorBillStatus;
  submittedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  paidJournalEntryId: string | null;
  documentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Inspection {
  id: string;
  orgId: string;
  propertyId: string;
  unitId: string;
  leaseId: string | null;
  inspectionType: InspectionType;
  scheduledAt: string;
  status: InspectionStatus;
  landlordSignedAt: string | null;
  tenantSignedAt: string | null;
  tenantRefusalReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionItem {
  id: string;
  inspectionId: string;
  room: string;
  itemDescription: string;
  conditionRating: InspectionConditionRating;
  notes: string | null;
  createdAt: string;
}
