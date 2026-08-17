package com.propertyvault.app.data.paymentreports

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
        assertEquals(1, (result as PaymentReportsResult.Loaded).reports.size)
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
        assertEquals(2, listed.reports.size)
    }

    @Test
    fun `reportPayment rejects a non-positive amount without calling the network`() = runTest {
        val repository = MockPaymentReportsRepository()

        val result = repository.reportPayment(
            ReportPaymentInput(amount = 0.0, paymentMethod = "cash", paymentDate = "2026-08-17", proofUri = null),
        )

        assertTrue(result is ReportPaymentResult.Error)
    }
}
