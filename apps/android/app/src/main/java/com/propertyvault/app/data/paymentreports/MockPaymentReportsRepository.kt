package com.propertyvault.app.data.paymentreports

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
}
