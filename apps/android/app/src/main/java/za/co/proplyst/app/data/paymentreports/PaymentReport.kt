package za.co.proplyst.app.data.paymentreports

import android.net.Uri

/** Mirrors packages/types/src/paymentReports.ts's PaymentReport interface -- Android V1
 * commercial-launch pass (WORKLOG.md this date), Phase 4. A tenant-reported-payment CLAIM, never
 * the ledger itself -- reviewed/confirmed by staff/owner server-side (confirm_payment_report()),
 * never something this app marks confirmed on-device. `tenantName`/`propertyName`/`documentId`
 * added Phase 3 (final gap-closure pass) for the owner/staff review screen -- null for a tenant's
 * own view of their own reports (the create/list-own contract never sends them, since a tenant
 * already knows their own name and property). */
data class PaymentReport(
    val id: String,
    val amount: Double,
    val paymentMethod: String,
    val paymentDate: String,
    val status: String,
    val rejectionReason: String?,
    val createdAt: String,
    val tenantName: String? = null,
    val propertyName: String? = null,
    val documentId: String? = null,
    /** Continuation pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §9 payment-review polish) -- true
     * when the tenant self-reported this payment; false means staff recorded it on the tenant's
     * behalf (the "cash collected by staff" case -- payment_reports_insert_staff RLS policy).
     * There is no reliable per-report collector DISPLAY NAME available (no profile-name field
     * resolves reportedByUserId to something safe to show) -- this flag is the honest, real
     * distinction the data actually supports, never a fabricated name. */
    val reportedByTenant: Boolean = true,
)

sealed interface PaymentReportsResult {
    data class Loaded(val reports: List<PaymentReport>) : PaymentReportsResult
    data class Error(val message: String) : PaymentReportsResult
}

sealed interface ReportPaymentResult {
    data class Success(val report: PaymentReport) : ReportPaymentResult
    data class Error(val message: String) : ReportPaymentResult
}

/** Result of a confirm/reject review action, or opening a proof document (Phase 3). */
sealed interface PaymentReviewResult {
    data object Success : PaymentReviewResult
    data class Error(val message: String) : PaymentReviewResult
}

sealed interface DocumentUrlResult {
    data class Success(val signedUrl: String, val mimeType: String?) : DocumentUrlResult
    data class Error(val message: String) : DocumentUrlResult
}

data class ReportPaymentInput(
    val amount: Double,
    val paymentMethod: String,
    val paymentDate: String,
    val proofUri: Uri?,
)

/** One real implementation (WebApiPaymentReportsRepository, backed by the live Next.js API) and
 * one mock (MockPaymentReportsRepository, deterministic fixture data), never mixed -- same split
 * every other repository in this app already uses. Hilt binds exactly one per build via
 * BuildConfig.USE_MOCK_DATA -- see di/RepositoryModule.kt. */
interface PaymentReportsRepository {
    /** Reports visible to the caller -- RLS decides the scope (a tenant's own reports, or every
     * report an owner/staff caller has property/org access to); this app never re-implements
     * that logic, it just renders whatever the shared GET endpoint returns. */
    suspend fun getMyPaymentReports(): PaymentReportsResult
    suspend fun reportPayment(input: ReportPaymentInput): ReportPaymentResult
    suspend fun confirmPaymentReport(id: String): PaymentReviewResult
    suspend fun rejectPaymentReport(id: String, reason: String): PaymentReviewResult
    suspend fun getDocumentUrl(documentId: String): DocumentUrlResult
}
