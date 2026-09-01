package za.co.proplyst.app.data.invoices

import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

/** Deterministic fixture data -- under the same `demo-property-1`/`demo-unit-1`/`demo-tenant-1`
 * ids every other Mock*Repository already uses, so the demo flow stays coherent end to end.
 * Never wired into the same binding as WebApiInvoicesRepository. */
@Singleton
class MockInvoicesRepository @Inject constructor() : InvoicesRepository {

    private val fixtures = listOf(
        Invoice(
            id = "demo-invoice-1",
            invoiceNumber = "INV-000201",
            tenantId = "demo-tenant-1",
            tenantName = "Naledi Khumalo",
            propertyId = "demo-property-1",
            propertyNickname = "Musgrave Flats",
            unitId = "demo-unit-1",
            unitLabel = "Unit 601",
            description = "August 2026 Rent",
            period = "2026-08-01",
            issuedAt = "2026-08-01T08:00:00Z",
            amount = 20000.0,
            paid = 15000.0,
            balance = 5000.0,
            displayStatus = "Partially paid",
            emailedAt = "2026-08-01T08:05:00Z",
            voidedAt = null,
            source = "rent_schedule",
        ),
        Invoice(
            id = "demo-invoice-2",
            invoiceNumber = "INV-000188",
            tenantId = "demo-tenant-1",
            tenantName = "Naledi Khumalo",
            propertyId = "demo-property-1",
            propertyNickname = "Musgrave Flats",
            unitId = "demo-unit-1",
            unitLabel = "Unit 601",
            description = "Water and electricity",
            period = "2026-07-28",
            issuedAt = "2026-07-28T08:00:00Z",
            amount = 850.0,
            paid = 850.0,
            balance = 0.0,
            displayStatus = "Paid",
            emailedAt = "2026-07-28T08:05:00Z",
            voidedAt = null,
            source = "manual",
        ),
    )

    private val paymentFixtures = mapOf(
        "demo-invoice-1" to listOf(
            InvoicePayment(
                id = "demo-payment-1",
                amount = 15000.0,
                paidAt = "2026-08-05",
                method = "eft",
                reference = "REF-EFT-8812",
                notes = null,
                reversedAt = null,
                reversalReason = null,
                createdAt = "2026-08-05T10:00:00Z",
            ),
        ),
        "demo-invoice-2" to listOf(
            InvoicePayment(
                id = "demo-payment-2",
                amount = 850.0,
                paidAt = "2026-07-29",
                method = "cash",
                reference = "REF-UTIL-PAY",
                notes = null,
                reversedAt = null,
                reversalReason = null,
                createdAt = "2026-07-29T09:00:00Z",
            ),
        ),
    )

    override suspend fun getInvoices(): InvoicesResult {
        delay(300)
        return InvoicesResult.Loaded(fixtures)
    }

    override suspend fun getInvoice(id: String): InvoiceDetailResult {
        delay(300)
        val invoice = fixtures.find { it.id == id }
            ?: return InvoiceDetailResult.Error("Invoice not found.")
        return InvoiceDetailResult.Loaded(
            InvoiceDetail(
                id = invoice.id,
                invoiceNumber = invoice.invoiceNumber,
                leaseId = "demo-lease-1",
                tenantId = invoice.tenantId,
                period = invoice.period,
                amount = invoice.amount,
                status = "issued",
                issuedAt = invoice.issuedAt,
                description = invoice.description,
                reference = null,
                voidedAt = invoice.voidedAt,
                voidReason = null,
                lineItems = listOf(
                    InvoiceLineItem(
                        id = "demo-line-1",
                        description = invoice.description,
                        quantity = 1.0,
                        unitPrice = invoice.amount,
                        amount = invoice.amount,
                    ),
                ),
                paid = invoice.paid,
                balance = invoice.balance,
                displayStatus = invoice.displayStatus,
            ),
        )
    }

    override suspend fun getInvoicePayments(invoiceId: String): InvoicePaymentsResult {
        delay(300)
        return InvoicePaymentsResult.Loaded(paymentFixtures[invoiceId].orEmpty())
    }

    override suspend fun recordPayment(invoiceId: String, input: RecordPaymentInput): RecordPaymentResult {
        delay(400)
        if (input.amount <= 0) {
            return RecordPaymentResult.Error("amount must be positive")
        }
        return RecordPaymentResult.Success(
            InvoicePayment(
                id = "demo-payment-new",
                amount = input.amount,
                paidAt = input.paidAt,
                method = input.method,
                reference = input.reference,
                notes = input.notes,
                reversedAt = null,
                reversalReason = null,
                createdAt = "2026-08-06T00:00:00Z",
            ),
        )
    }

    override suspend fun downloadInvoicePdf(invoiceId: String): InvoicePdfResult {
        delay(300)
        // Mock mode never has a real file to hand back -- demo builds do not exercise the PDF
        // viewer, matching the existing "no real network dependency" scope of every other mock.
        return InvoicePdfResult.Error("Invoice PDF is not available in demo mode.")
    }
}
