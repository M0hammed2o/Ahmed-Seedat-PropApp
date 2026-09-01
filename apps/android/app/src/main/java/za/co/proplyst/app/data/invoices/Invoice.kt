package za.co.proplyst.app.data.invoices

import android.net.Uri

/** Domain model -- mirrors `InvoiceWithBalanceDto` (GET /api/v1/invoices), which itself mirrors
 * `apps/admin/lib/invoicing.ts`'s `InvoiceWithBalance` interface field-for-field. `paid`/
 * `balance`/`displayStatus` are the SERVER's own computation (`loadInvoicesWithBalances()`) --
 * this app never recomputes them, matching the exact "backend remains authoritative" rule this
 * pass was given. Shared by both portals: an owner/staff caller sees every invoice their RLS
 * (`invoices_select_org_member`) grants; a tenant caller sees only their own ISSUED invoices
 * (`invoices_select_tenant_self`, migration 20260101000162 -- a draft is never in this list). */
data class Invoice(
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
    val issuedAt: String?,
    val amount: Double,
    val paid: Double,
    val balance: Double,
    val displayStatus: String,
    val emailedAt: String?,
    val voidedAt: String?,
    val source: String,
)

/** GET /api/v1/invoices/:id -- the raw invoice header plus line items and the same paid/balance/
 * displayStatus computation as the list. `paid`/`balance`/`displayStatus` are nullable -- `null`
 * means "the server's balance-enrichment step failed this one time, reload to try again," never
 * "zero" (see the route's own doc comment; this app must not treat null as R0 paid). */
data class InvoiceDetail(
    val id: String,
    val invoiceNumber: String,
    val leaseId: String,
    val tenantId: String,
    val period: String,
    val amount: Double,
    val status: String,
    val issuedAt: String?,
    val description: String?,
    val reference: String?,
    val voidedAt: String?,
    val voidReason: String?,
    val lineItems: List<InvoiceLineItem>,
    val paid: Double?,
    val balance: Double?,
    val displayStatus: String?,
)

data class InvoiceLineItem(
    val id: String,
    val description: String,
    val quantity: Double,
    val unitPrice: Double,
    val amount: Double,
)

/** Mirrors `apps/android`'s `PaymentReport` -- a real financial-ledger row, never something this
 * app marks confirmed/reversed/void on-device. */
data class InvoicePayment(
    val id: String,
    val amount: Double,
    val paidAt: String,
    val method: String?,
    val reference: String?,
    val notes: String?,
    val reversedAt: String?,
    val reversalReason: String?,
    val createdAt: String,
)

sealed interface InvoicesResult {
    data class Loaded(val invoices: List<Invoice>) : InvoicesResult
    data class Error(val message: String) : InvoicesResult
}

sealed interface InvoiceDetailResult {
    data class Loaded(val detail: InvoiceDetail) : InvoiceDetailResult
    data class Error(val message: String) : InvoiceDetailResult
}

sealed interface InvoicePaymentsResult {
    data class Loaded(val payments: List<InvoicePayment>) : InvoicePaymentsResult
    data class Error(val message: String) : InvoicePaymentsResult
}

/** Server remains authoritative for overpayment/allocation rules (record_invoice_payment(), no
 * bypass parameter exists) -- this is only the caller's own input, submitted as-is. */
data class RecordPaymentInput(
    val amount: Double,
    val paidAt: String,
    val method: String,
    val reference: String?,
    val notes: String?,
)

sealed interface RecordPaymentResult {
    data class Success(val payment: InvoicePayment) : RecordPaymentResult
    data class Error(val message: String) : RecordPaymentResult
}

sealed interface InvoicePdfResult {
    /** A local cache file the PDF was written to -- callers open it via a `FileProvider` content
     * URI + `ACTION_VIEW`, never a raw `file://` Uri (blocked by `FileUriExposedException` on
     * modern Android and, separately, would carry no auth header for a second fetch anyway --
     * this app downloads the bytes once, authenticated, and hands the caller a local file). */
    data class Success(val fileUri: Uri) : InvoicePdfResult
    data class Error(val message: String) : InvoicePdfResult
}

/** One real implementation (WebApiInvoicesRepository, backed by the live Next.js API) and one
 * mock (MockInvoicesRepository, deterministic fixture data), never mixed -- the same split every
 * other repository in this app already uses. */
interface InvoicesRepository {
    suspend fun getInvoices(): InvoicesResult
    suspend fun getInvoice(id: String): InvoiceDetailResult
    suspend fun getInvoicePayments(invoiceId: String): InvoicePaymentsResult
    /** Server-side role gate (accountant+ org role) is the real authorization -- a caller without
     * that role gets a real 403 from the server; this app's own UI hiding of the "Record Payment"
     * control (RecordPaymentViewModel/screen, gated on OrgMembership.role) is a UX nicety on top
     * of that, never the enforcement boundary itself. */
    suspend fun recordPayment(invoiceId: String, input: RecordPaymentInput): RecordPaymentResult
    suspend fun downloadInvoicePdf(invoiceId: String): InvoicePdfResult
}
