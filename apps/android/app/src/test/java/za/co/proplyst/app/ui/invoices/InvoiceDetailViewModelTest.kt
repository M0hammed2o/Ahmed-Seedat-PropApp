package za.co.proplyst.app.ui.invoices

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.AuthState
import za.co.proplyst.app.data.auth.OrgMembership
import za.co.proplyst.app.data.invoices.InvoiceDetail
import za.co.proplyst.app.data.invoices.InvoiceDetailResult
import za.co.proplyst.app.data.invoices.InvoicePayment
import za.co.proplyst.app.data.invoices.InvoicePaymentsResult
import za.co.proplyst.app.data.invoices.InvoicePdfResult
import za.co.proplyst.app.data.invoices.InvoicesRepository
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Invoice V1 completion pass (WORKLOG.md this date). Pins down: (1) detail + payment history
 * load independently and both surface loading/error correctly, (2) `canRecordPayment` mirrors
 * `has_org_role()`'s real tiers (accountant/manager/principal yes, agent/viewer/tenant-with-no-
 * organizations no) -- a UI-layer check only, the server's own role gate on POST .../payments
 * remains the real enforcement (see the property's own doc comment), and (3) PDF open success/
 * error both surface through their own dedicated state, never silently discarded. */
@OptIn(ExperimentalCoroutinesApi::class)
class InvoiceDetailViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun savedStateHandle() = SavedStateHandle(mapOf("invoiceId" to "inv1"))

    private val sampleDetail = InvoiceDetail(
        id = "inv1",
        invoiceNumber = "INV-000001",
        leaseId = "l1",
        tenantId = "t1",
        period = "2026-08-01",
        amount = 20000.0,
        status = "issued",
        issuedAt = "2026-08-01T00:00:00Z",
        description = "August 2026 Rent",
        reference = null,
        voidedAt = null,
        voidReason = null,
        lineItems = emptyList(),
        paid = 15000.0,
        balance = 5000.0,
        displayStatus = "Partially paid",
    )

    private fun authRepository(organizations: List<OrgMembership> = emptyList()): AuthRepository {
        val repo = mockk<AuthRepository>()
        val state: AuthState = if (organizations.isEmpty()) {
            AuthState.Unauthenticated
        } else {
            AuthState.Authenticated(userId = "u1", organizations = organizations, tenancies = emptyList())
        }
        every { repo.authState } returns MutableStateFlow(state)
        return repo
    }

    @Test
    fun `loads detail and payment history independently, both Loaded`() = runTest {
        val invoices = mockk<InvoicesRepository>()
        coEvery { invoices.getInvoice("inv1") } returns InvoiceDetailResult.Loaded(sampleDetail)
        coEvery { invoices.getInvoicePayments("inv1") } returns InvoicePaymentsResult.Loaded(emptyList())

        val viewModel = InvoiceDetailViewModel(invoices, authRepository(), savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        val detailState = viewModel.detailState.value
        assertTrue(detailState is InvoiceDetailUiState.Loaded)
        assertEquals(5000.0, (detailState as InvoiceDetailUiState.Loaded).detail.balance)
        assertTrue(viewModel.paymentsState.value is PaymentHistoryUiState.Loaded)
    }

    @Test
    fun `surfaces an invoice-load error independently of payment history`() = runTest {
        val invoices = mockk<InvoicesRepository>()
        coEvery { invoices.getInvoice("inv1") } returns InvoiceDetailResult.Error("Failed to load this invoice.")
        coEvery { invoices.getInvoicePayments("inv1") } returns InvoicePaymentsResult.Loaded(emptyList())

        val viewModel = InvoiceDetailViewModel(invoices, authRepository(), savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.detailState.value is InvoiceDetailUiState.Error)
        assertTrue(viewModel.paymentsState.value is PaymentHistoryUiState.Loaded)
    }

    @Test
    fun `canRecordPayment is true for accountant, manager, and principal`() {
        for (role in listOf("accountant", "manager", "principal")) {
            val invoices = mockk<InvoicesRepository>(relaxed = true)
            val viewModel = InvoiceDetailViewModel(
                invoices,
                authRepository(listOf(OrgMembership(orgId = "org1", role = role, status = "active"))),
                savedStateHandle(),
            )
            assertTrue("role=$role should be able to record payment", viewModel.canRecordPayment)
        }
    }

    @Test
    fun `canRecordPayment is false for agent, viewer, and a caller with no organizations`() {
        for (role in listOf("agent", "viewer")) {
            val invoices = mockk<InvoicesRepository>(relaxed = true)
            val viewModel = InvoiceDetailViewModel(
                invoices,
                authRepository(listOf(OrgMembership(orgId = "org1", role = role, status = "active"))),
                savedStateHandle(),
            )
            assertFalse("role=$role should NOT be able to record payment", viewModel.canRecordPayment)
        }
        // A tenant caller (no organizations at all) -- the exact scenario this pass's own
        // instruction calls out ("respect existing backend authorization... never expose to a
        // tenant").
        val invoices = mockk<InvoicesRepository>(relaxed = true)
        val tenantViewModel = InvoiceDetailViewModel(invoices, authRepository(emptyList()), savedStateHandle())
        assertFalse(tenantViewModel.canRecordPayment)
    }

    @Test
    fun `openPdf success populates pdfUri`() = runTest {
        val invoices = mockk<InvoicesRepository>()
        coEvery { invoices.getInvoice("inv1") } returns InvoiceDetailResult.Loaded(sampleDetail)
        coEvery { invoices.getInvoicePayments("inv1") } returns InvoicePaymentsResult.Loaded(emptyList())
        val uri = mockk<Uri>()
        coEvery { invoices.downloadInvoicePdf("inv1") } returns InvoicePdfResult.Success(uri)

        val viewModel = InvoiceDetailViewModel(invoices, authRepository(), savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.openPdf()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(uri, viewModel.pdfUri.value)
        assertEquals(null, viewModel.pdfError.value)
    }

    @Test
    fun `openPdf failure surfaces pdfError, never a fake success`() = runTest {
        val invoices = mockk<InvoicesRepository>()
        coEvery { invoices.getInvoice("inv1") } returns InvoiceDetailResult.Loaded(sampleDetail)
        coEvery { invoices.getInvoicePayments("inv1") } returns InvoicePaymentsResult.Loaded(emptyList())
        coEvery { invoices.downloadInvoicePdf("inv1") } returns InvoicePdfResult.Error("Failed to open this invoice.")

        val viewModel = InvoiceDetailViewModel(invoices, authRepository(), savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.openPdf()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("Failed to open this invoice.", viewModel.pdfError.value)
        assertEquals(null, viewModel.pdfUri.value)
    }
}
