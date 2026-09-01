package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.Serializable

// Wire shape for the Next.js web API's invoice/payment endpoints (NOT PostgREST -- API_BASE_URL,
// camelCase, matching PaymentReportDto.kt's own documented convention). Android V1 completion
// pass (WORKLOG.md this date).
//
// Two deliberately different shapes, matching what the two GET routes actually return:
// GET /api/v1/invoices returns the pre-joined, already-balance-computed InvoiceWithBalance shape
// (apps/admin/lib/invoicing.ts) directly; GET /api/v1/invoices/:id returns the RAW invoice row
// (mapInvoiceRow()) plus paid/balance/displayStatus bolted on separately. Never reconciled into
// one shape here, since that's exactly what the two server-side response bodies actually are --
// inventing a unified DTO would misrepresent the wire contract, not simplify it.

/** GET /api/v1/invoices -- the ONE list endpoint behind both owner/staff and tenant invoice
 * screens. `paid`/`balance`/`displayStatus` are computed server-side (loadInvoicesWithBalances())
 * and never recomputed here -- see InvoicesRepository's own doc comment. */
@Serializable
data class InvoiceWithBalanceDto(
    val id: String,
    val invoiceNumber: String,
    val tenantId: String,
    val tenantName: String,
    val propertyId: String,
    val propertyNickname: String,
    val unitId: String,
    val unitLabel: String,
    val description: String,
    val period: String,
    val issuedAt: String? = null,
    val amount: Double,
    val paid: Double,
    val balance: Double,
    val displayStatus: String,
    val emailedAt: String? = null,
    val voidedAt: String? = null,
    val source: String,
)

@Serializable
data class InvoiceListResponse(val invoices: List<InvoiceWithBalanceDto>)

/** GET /api/v1/invoices/:id -- the raw invoice row (`mapInvoiceRow()`) plus line items and the
 * same paid/balance/displayStatus computation as the list endpoint, bolted on. `paid`/`balance`/
 * `displayStatus` are nullable -- the route tolerates the balance-enrichment step failing without
 * failing the whole request (see the route's own doc comment); a `null` here means "reload to
 * try again," never "zero." */
@Serializable
data class InvoiceDetailDto(
    val id: String,
    val orgId: String,
    val invoiceNumber: String,
    val leaseId: String,
    val tenantId: String,
    val period: String,
    val amount: Double,
    val status: String,
    val issuedAt: String? = null,
    val description: String? = null,
    val reference: String? = null,
    val voidedAt: String? = null,
    val voidReason: String? = null,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class InvoiceLineItemDto(
    val id: String,
    val invoiceId: String,
    val description: String,
    val quantity: Double,
    val unitPrice: Double,
    val amount: Double,
    val sortOrder: Int,
)

@Serializable
data class InvoiceDetailResponse(
    val invoice: InvoiceDetailDto,
    val lineItems: List<InvoiceLineItemDto>,
    val paid: Double? = null,
    val balance: Double? = null,
    val displayStatus: String? = null,
)

/** GET/POST /api/v1/invoices/:id/payments -- the one payment-recording path for both manual and
 * rent-sourced invoices (unified invoice-payment ledger, migration 20260101000158). */
@Serializable
data class InvoicePaymentDto(
    val id: String,
    val orgId: String,
    val tenantId: String,
    val invoiceId: String,
    val amount: Double,
    val paidAt: String,
    val method: String? = null,
    val reference: String? = null,
    val notes: String? = null,
    val recordedBy: String? = null,
    val bankTransactionId: String? = null,
    val reversedAt: String? = null,
    val reversedByUserId: String? = null,
    val reversalReason: String? = null,
    val createdAt: String,
)

@Serializable
data class InvoicePaymentListResponse(val payments: List<InvoicePaymentDto>)

@Serializable
data class InvoicePaymentCreateResponse(val payment: InvoicePaymentDto)

/** Mirrors `invoicePaymentCreateSchema` (packages/validation) field-for-field -- server remains
 * authoritative for overpayment/allocation rules; this app never computes or enforces them, only
 * submits the caller's own input and displays whatever comes back (a 409 `would_overpay`,
 * a role-gated 403, or success). */
@Serializable
data class RecordInvoicePaymentRequest(
    val amount: Double,
    val paidAt: String,
    val method: String,
    val reference: String? = null,
    val notes: String? = null,
)
