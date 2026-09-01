package za.co.proplyst.app.data.invoices

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.InvoiceDetailResponse
import za.co.proplyst.app.data.network.dto.InvoiceLineItemDto
import za.co.proplyst.app.data.network.dto.InvoicePaymentDto
import za.co.proplyst.app.data.network.dto.InvoiceWithBalanceDto
import za.co.proplyst.app.data.network.dto.RecordInvoicePaymentRequest
import za.co.proplyst.app.data.network.dto.WebApiErrorBody
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import retrofit2.Response
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Real implementation -- Invoice V1 completion pass (WORKLOG.md this date). Every read is a plain
 * passthrough of the server's own response; `paid`/`balance`/`displayStatus`/overpayment/role
 * rules are computed and enforced server-side ONLY (`apps/admin/lib/invoicing.ts`,
 * `record_invoice_payment()`) -- grepped before writing this file to confirm no arithmetic on
 * `amount`/`paid`/`balance` exists anywhere in this class.
 */
@Singleton
class WebApiInvoicesRepository @Inject constructor(
    private val webApi: WebApi,
    @ApplicationContext private val context: Context,
) : InvoicesRepository {

    private val errorJson = Json { ignoreUnknownKeys = true }

    override suspend fun getInvoices(): InvoicesResult {
        return try {
            val response = webApi.getInvoices()
            if (!response.isSuccessful) {
                return InvoicesResult.Error(errorMessage(response) ?: "Failed to load invoices.")
            }
            val invoices = response.body()?.invoices.orEmpty().map { it.toDomain() }
            InvoicesResult.Loaded(invoices)
        } catch (e: Exception) {
            InvoicesResult.Error(e.message ?: "Failed to load invoices — check your connection.")
        }
    }

    override suspend fun getInvoice(id: String): InvoiceDetailResult {
        return try {
            val response = webApi.getInvoice(id)
            if (!response.isSuccessful) {
                return InvoiceDetailResult.Error(errorMessage(response) ?: "Failed to load this invoice.")
            }
            val body = response.body() ?: return InvoiceDetailResult.Error("Failed to load this invoice.")
            InvoiceDetailResult.Loaded(body.toDomain())
        } catch (e: Exception) {
            InvoiceDetailResult.Error(e.message ?: "Failed to load this invoice — check your connection.")
        }
    }

    override suspend fun getInvoicePayments(invoiceId: String): InvoicePaymentsResult {
        return try {
            val response = webApi.getInvoicePayments(invoiceId)
            if (!response.isSuccessful) {
                return InvoicePaymentsResult.Error(errorMessage(response) ?: "Failed to load payment history.")
            }
            val payments = response.body()?.payments.orEmpty().map { it.toDomain() }
            InvoicePaymentsResult.Loaded(payments)
        } catch (e: Exception) {
            InvoicePaymentsResult.Error(e.message ?: "Failed to load payment history — check your connection.")
        }
    }

    override suspend fun recordPayment(invoiceId: String, input: RecordPaymentInput): RecordPaymentResult {
        return try {
            val response = webApi.recordInvoicePayment(
                invoiceId,
                RecordInvoicePaymentRequest(
                    amount = input.amount,
                    paidAt = input.paidAt,
                    method = input.method,
                    reference = input.reference,
                    notes = input.notes,
                ),
            )
            if (!response.isSuccessful) {
                // Covers the 403 (insufficient role) and 409 (would_overpay) cases the server
                // itself enforces -- this app never pre-computes either, it only relays whatever
                // the server decided, per this pass's own "no second accounting engine" rule.
                return RecordPaymentResult.Error(errorMessage(response) ?: "Failed to record this payment.")
            }
            val body = response.body() ?: return RecordPaymentResult.Error("Failed to record this payment.")
            RecordPaymentResult.Success(body.payment.toDomain())
        } catch (e: Exception) {
            RecordPaymentResult.Error(e.message ?: "Failed to record this payment — check your connection.")
        }
    }

    override suspend fun downloadInvoicePdf(invoiceId: String): InvoicePdfResult {
        return try {
            val response = webApi.getInvoicePdf(invoiceId)
            if (!response.isSuccessful) {
                return InvoicePdfResult.Error(errorMessage(response) ?: "Failed to open this invoice (${response.code()}).")
            }
            val body = response.body() ?: return InvoicePdfResult.Error("Failed to open this invoice.")

            val invoicesDir = File(context.cacheDir, "invoices").apply { mkdirs() }
            val file = File(invoicesDir, "invoice-$invoiceId.pdf")
            body.byteStream().use { input ->
                file.outputStream().use { output -> input.copyTo(output) }
            }
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            InvoicePdfResult.Success(uri)
        } catch (e: Exception) {
            InvoicePdfResult.Error(e.message ?: "Failed to open this invoice — check your connection.")
        }
    }

    private fun errorMessage(response: Response<*>): String? {
        val raw = response.errorBody()?.string() ?: return null
        return try {
            errorJson.decodeFromString<WebApiErrorBody>(raw).error?.message
        } catch (_: Exception) {
            null
        }
    }

    private fun InvoiceWithBalanceDto.toDomain() = Invoice(
        id = id,
        invoiceNumber = invoiceNumber,
        tenantId = tenantId,
        tenantName = tenantName,
        propertyId = propertyId,
        propertyNickname = propertyNickname,
        unitId = unitId,
        unitLabel = unitLabel,
        description = description,
        period = period,
        issuedAt = issuedAt,
        amount = amount,
        paid = paid,
        balance = balance,
        displayStatus = displayStatus,
        emailedAt = emailedAt,
        voidedAt = voidedAt,
        source = source,
    )

    private fun InvoiceDetailResponse.toDomain() = InvoiceDetail(
        id = invoice.id,
        invoiceNumber = invoice.invoiceNumber,
        leaseId = invoice.leaseId,
        tenantId = invoice.tenantId,
        period = invoice.period,
        amount = invoice.amount,
        status = invoice.status,
        issuedAt = invoice.issuedAt,
        description = invoice.description,
        reference = invoice.reference,
        voidedAt = invoice.voidedAt,
        voidReason = invoice.voidReason,
        lineItems = lineItems.map { it.toDomain() },
        paid = paid,
        balance = balance,
        displayStatus = displayStatus,
    )

    private fun InvoiceLineItemDto.toDomain() = InvoiceLineItem(
        id = id,
        description = description,
        quantity = quantity,
        unitPrice = unitPrice,
        amount = amount,
    )

    private fun InvoicePaymentDto.toDomain() = InvoicePayment(
        id = id,
        amount = amount,
        paidAt = paidAt,
        method = method,
        reference = reference,
        notes = notes,
        reversedAt = reversedAt,
        reversalReason = reversalReason,
        createdAt = createdAt,
    )
}
