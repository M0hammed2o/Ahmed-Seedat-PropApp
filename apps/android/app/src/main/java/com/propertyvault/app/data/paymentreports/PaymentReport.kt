package com.propertyvault.app.data.paymentreports

import android.net.Uri

/** Mirrors packages/types/src/paymentReports.ts's PaymentReport interface -- Android V1
 * commercial-launch pass (WORKLOG.md this date), Phase 4. A tenant-reported-payment CLAIM, never
 * the ledger itself -- reviewed/confirmed by staff/owner server-side (confirm_payment_report()),
 * never something this app marks confirmed on-device. */
data class PaymentReport(
    val id: String,
    val amount: Double,
    val paymentMethod: String,
    val paymentDate: String,
    val status: String,
    val rejectionReason: String?,
    val createdAt: String,
)

sealed interface PaymentReportsResult {
    data class Loaded(val reports: List<PaymentReport>) : PaymentReportsResult
    data class Error(val message: String) : PaymentReportsResult
}

sealed interface ReportPaymentResult {
    data class Success(val report: PaymentReport) : ReportPaymentResult
    data class Error(val message: String) : ReportPaymentResult
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
    suspend fun getMyPaymentReports(): PaymentReportsResult
    suspend fun reportPayment(input: ReportPaymentInput): ReportPaymentResult
}
