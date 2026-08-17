package za.co.proplyst.app.data.paymentreports

import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MockPaymentReportsRepository @Inject constructor() : PaymentReportsRepository {

    private val reports = mutableListOf(
        PaymentReport(
            id = "demo-payment-report-1",
            amount = 10650.0,
            paymentMethod = "eft",
            paymentDate = "2026-07-01",
            status = "confirmed",
            rejectionReason = null,
            createdAt = "2026-07-01T09:00:00Z",
            tenantName = "Jane Tenant",
            propertyName = "Sea Point Apartment",
        ),
        PaymentReport(
            id = "demo-payment-report-2",
            amount = 8500.0,
            paymentMethod = "cash",
            paymentDate = "2026-08-01",
            status = "reported",
            rejectionReason = null,
            createdAt = "2026-08-01T09:00:00Z",
            tenantName = "Jane Tenant",
            propertyName = "Sea Point Apartment",
            documentId = "demo-document-1",
        ),
    )

    override suspend fun getMyPaymentReports(): PaymentReportsResult {
        delay(300)
        return PaymentReportsResult.Loaded(reports.toList())
    }

    override suspend fun reportPayment(input: ReportPaymentInput): ReportPaymentResult {
        delay(400)
        if (input.amount <= 0) {
            return ReportPaymentResult.Error("Amount must be a positive number.")
        }
        val report = PaymentReport(
            id = "demo-payment-report-${reports.size + 1}",
            amount = input.amount,
            paymentMethod = input.paymentMethod,
            paymentDate = input.paymentDate,
            status = "reported",
            rejectionReason = null,
            createdAt = "2026-08-17T00:00:00Z",
        )
        reports.add(0, report)
        return ReportPaymentResult.Success(report)
    }

    override suspend fun confirmPaymentReport(id: String): PaymentReviewResult {
        delay(300)
        val index = reports.indexOfFirst { it.id == id }
        if (index < 0) return PaymentReviewResult.Error("Payment report not found.")
        reports[index] = reports[index].copy(status = "confirmed")
        return PaymentReviewResult.Success
    }

    override suspend fun rejectPaymentReport(id: String, reason: String): PaymentReviewResult {
        delay(300)
        if (reason.isBlank()) return PaymentReviewResult.Error("A reason is required.")
        val index = reports.indexOfFirst { it.id == id }
        if (index < 0) return PaymentReviewResult.Error("Payment report not found.")
        reports[index] = reports[index].copy(status = "rejected", rejectionReason = reason)
        return PaymentReviewResult.Success
    }

    override suspend fun getDocumentUrl(documentId: String): DocumentUrlResult {
        delay(200)
        return DocumentUrlResult.Success(
            signedUrl = "https://example.test/demo-proof-of-payment.pdf",
            mimeType = "application/pdf",
        )
    }
}
