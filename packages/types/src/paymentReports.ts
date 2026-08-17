import type { PaymentReportMethod, PaymentReportStatus } from './enums';

// WhatsApp V1 final pre-production pass, Phase 1/2 (WORKLOG.md this date). Mirrors
// payment_reports exactly (migration 20260101000106) -- a tenant-reported-payment claim layer
// sitting above rent_schedules/cash_receipts, never a replacement for either.
export interface PaymentReport {
  id: string;
  orgId: string;
  propertyId: string;
  leaseId: string;
  rentScheduleId: string | null;
  tenantId: string;
  reportedByTenant: boolean;
  reportedByUserId: string;
  amount: number;
  paymentMethod: PaymentReportMethod;
  paymentDate: string;
  documentId: string | null;
  status: PaymentReportStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}
