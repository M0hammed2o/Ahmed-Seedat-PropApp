package za.co.proplyst.app.data.paymentreports

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockPaymentReportsRepositoryTest {

    @Test
    fun `getMyPaymentReports returns the fixture as Loaded`() = runTest {
        val repository = MockPaymentReportsRepository()

        val result = repository.getMyPaymentReports()

        assertTrue(result is PaymentReportsResult.Loaded)
        assertEquals(2, (result as PaymentReportsResult.Loaded).reports.size)
    }

    @Test
    fun `reportPayment adds a new report starting in reported status`() = runTest {
        val repository = MockPaymentReportsRepository()

        val result = repository.reportPayment(
            ReportPaymentInput(amount = 5000.0, paymentMethod = "cash", paymentDate = "2026-08-17", proofUri = null),
        )

        assertTrue(result is ReportPaymentResult.Success)
        val report = (result as ReportPaymentResult.Success).report
        assertEquals("reported", report.status)
        assertEquals(5000.0, report.amount, 0.0)

        val listed = repository.getMyPaymentReports() as PaymentReportsResult.Loaded
        assertEquals(3, listed.reports.size)
    }

    @Test
    fun `reportPayment rejects a non-positive amount without calling the network`() = runTest {
        val repository = MockPaymentReportsRepository()

        val result = repository.reportPayment(
            ReportPaymentInput(amount = 0.0, paymentMethod = "cash", paymentDate = "2026-08-17", proofUri = null),
        )

        assertTrue(result is ReportPaymentResult.Error)
    }

    @Test
    fun `confirmPaymentReport marks the matching report confirmed`() = runTest {
        val repository = MockPaymentReportsRepository()

        val result = repository.confirmPaymentReport("demo-payment-report-2")

        assertTrue(result is PaymentReviewResult.Success)
        val updated = (repository.getMyPaymentReports() as PaymentReportsResult.Loaded).reports
            .first { it.id == "demo-payment-report-2" }
        assertEquals("confirmed", updated.status)
    }

    @Test
    fun `confirmPaymentReport errors for an unknown id`() = runTest {
        val repository = MockPaymentReportsRepository()

        val result = repository.confirmPaymentReport("does-not-exist")

        assertTrue(result is PaymentReviewResult.Error)
    }

    @Test
    fun `rejectPaymentReport requires a non-blank reason`() = runTest {
        val repository = MockPaymentReportsRepository()

        val result = repository.rejectPaymentReport("demo-payment-report-2", "  ")

        assertTrue(result is PaymentReviewResult.Error)
    }

    @Test
    fun `rejectPaymentReport marks the matching report rejected with the given reason`() = runTest {
        val repository = MockPaymentReportsRepository()

        val result = repository.rejectPaymentReport("demo-payment-report-2", "Illegible proof")

        assertTrue(result is PaymentReviewResult.Success)
        val updated = (repository.getMyPaymentReports() as PaymentReportsResult.Loaded).reports
            .first { it.id == "demo-payment-report-2" }
        assertEquals("rejected", updated.status)
        assertEquals("Illegible proof", updated.rejectionReason)
    }

    @Test
    fun `getDocumentUrl returns a signed url`() = runTest {
        val repository = MockPaymentReportsRepository()

        val result = repository.getDocumentUrl("demo-document-1")

        assertTrue(result is DocumentUrlResult.Success)
        assertTrue((result as DocumentUrlResult.Success).signedUrl.isNotBlank())
    }
}
