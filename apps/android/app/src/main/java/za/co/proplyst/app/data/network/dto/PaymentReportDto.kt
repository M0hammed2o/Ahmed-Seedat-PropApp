package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.Serializable

// Wire shape for the Next.js web API's payment-reports endpoints (NOT PostgREST -- these hit
// API_BASE_URL, `Content-Type: application/json`, already camelCase per mapPaymentReportRow()
// (apps/admin/lib/paymentReports.ts), unlike PostgrestApi's DTOs, which are snake_case straight
// off Postgres columns). Android V1 commercial-launch pass (WORKLOG.md this date).

@Serializable
data class PaymentReportDto(
    val id: String,
    val orgId: String,
    val propertyId: String,
    val leaseId: String,
    val rentScheduleId: String? = null,
    val tenantId: String,
    val reportedByTenant: Boolean,
    val reportedByUserId: String,
    val amount: Double,
    val paymentMethod: String,
    val paymentDate: String,
    val documentId: String? = null,
    val status: String,
    val reviewedBy: String? = null,
    val reviewedAt: String? = null,
    val rejectionReason: String? = null,
    val createdAt: String,
    val updatedAt: String,
    // Present only on GET /api/v1/payment-reports (the staff/owner review listing) -- omitted by
    // POST .../tenant-portal/payment-reports's own create response. Android V1 final gap-closure
    // pass, Phase 3.
    val tenantName: String? = null,
    val propertyName: String? = null,
)

@Serializable
data class PaymentReportListResponse(val paymentReports: List<PaymentReportDto>)

@Serializable
data class PaymentReportCreateResponse(val paymentReport: PaymentReportDto)

@Serializable
data class RejectPaymentReportRequest(val reason: String)

/** GET /api/v1/documents/:id -- Android V1 final gap-closure pass, Phase 3/5. */
@Serializable
data class DocumentDetailResponse(val document: DocumentDto, val signedUrl: String)

@Serializable
data class DocumentDto(
    val id: String,
    val originalFileName: String? = null,
    val mimeType: String? = null,
    val documentType: String? = null,
    val createdAt: String? = null,
)

/** GET api/v1/documents (Android V1 final gap-closure pass, WORKLOG.md this date, Phase 5) --
 * RLS (`documents_select_tenant_self`) scopes a tenant caller to only documents explicitly
 * tagged with their own lease_id; no filter[property_id] is sent, matching how this app's other
 * "my own" endpoints rely on RLS rather than a client-supplied scope. */
@Serializable
data class DocumentListResponse(val documents: List<DocumentDto>)

@Serializable
data class WebApiErrorBody(val error: WebApiErrorDetail? = null)

@Serializable
data class WebApiErrorDetail(val code: String? = null, val message: String? = null)
