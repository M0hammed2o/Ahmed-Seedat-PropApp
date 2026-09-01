package za.co.proplyst.app.data.invoices

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockInvoicesRepositoryTest {

    @Test
    fun `getInvoices returns deterministic fixtures with a consistent paid plus balance equals amount`() = runTest {
        val repository = MockInvoicesRepository()
        val result = repository.getInvoices()

        assertTrue(result is InvoicesResult.Loaded)
        val invoices = (result as InvoicesResult.Loaded).invoices
        assertTrue(invoices.isNotEmpty())
        invoices.forEach { assertEquals(it.amount, it.paid + it.balance, 0.01) }
    }

    @Test
    fun `getInvoice returns detail matching the list fixture for the same id`() = runTest {
        val repository = MockInvoicesRepository()
        val list = (repository.getInvoices() as InvoicesResult.Loaded).invoices
        val target = list.first()

        val detailResult = repository.getInvoice(target.id)

        assertTrue(detailResult is InvoiceDetailResult.Loaded)
        val detail = (detailResult as InvoiceDetailResult.Loaded).detail
        assertEquals(target.balance, detail.balance)
        assertEquals(target.paid, detail.paid)
    }

    @Test
    fun `getInvoice returns Error for an unknown id`() = runTest {
        val repository = MockInvoicesRepository()
        val result = repository.getInvoice("not-a-real-id")
        assertTrue(result is InvoiceDetailResult.Error)
    }

    @Test
    fun `recordPayment rejects a non-positive amount, matching the server's own validation`() = runTest {
        val repository = MockInvoicesRepository()
        val result = repository.recordPayment(
            "demo-invoice-1",
            RecordPaymentInput(amount = 0.0, paidAt = "2026-08-20", method = "eft", reference = null, notes = null),
        )
        assertTrue(result is RecordPaymentResult.Error)
    }

    @Test
    fun `recordPayment succeeds for a positive amount`() = runTest {
        val repository = MockInvoicesRepository()
        val result = repository.recordPayment(
            "demo-invoice-1",
            RecordPaymentInput(amount = 500.0, paidAt = "2026-08-20", method = "cash", reference = null, notes = null),
        )
        assertTrue(result is RecordPaymentResult.Success)
        assertEquals(500.0, (result as RecordPaymentResult.Success).payment.amount, 0.0)
    }

    @Test
    fun `downloadInvoicePdf fails explicitly in demo mode, never a fake success`() = runTest {
        val repository = MockInvoicesRepository()
        val result = repository.downloadInvoicePdf("demo-invoice-1")
        assertTrue(result is InvoicePdfResult.Error)
    }
}
