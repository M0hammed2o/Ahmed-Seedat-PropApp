package za.co.proplyst.app.ui.invoices

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.AuthState
import za.co.proplyst.app.data.auth.canRecordPayment
import za.co.proplyst.app.data.invoices.Invoice
import za.co.proplyst.app.data.invoices.InvoiceDetail
import za.co.proplyst.app.data.invoices.InvoiceDetailResult
import za.co.proplyst.app.data.invoices.InvoicePayment
import za.co.proplyst.app.data.invoices.InvoicePaymentsResult
import za.co.proplyst.app.data.invoices.InvoicePdfResult
import za.co.proplyst.app.data.invoices.InvoicesRepository
import za.co.proplyst.app.data.invoices.InvoicesResult
import za.co.proplyst.app.data.invoices.RecordPaymentInput
import za.co.proplyst.app.data.invoices.RecordPaymentResult
import javax.inject.Inject

sealed interface InvoicesListUiState {
    data object Loading : InvoicesListUiState
    data class Empty(val message: String) : InvoicesListUiState
    data class Loaded(val invoices: List<Invoice>) : InvoicesListUiState
    data class Error(val message: String) : InvoicesListUiState
}

/** Shared by both portals -- Invoice V1 completion pass (WORKLOG.md this date). No `orgId`/
 * `tenantId` filter sent or held here: `InvoicesRepository.getInvoices()` relies entirely on
 * server-side RLS to decide which rows come back, exactly matching every other "my own" list
 * this app already has. */
@HiltViewModel
class InvoicesListViewModel @Inject constructor(
    private val repository: InvoicesRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow<InvoicesListUiState>(InvoicesListUiState.Loading)
    val uiState: StateFlow<InvoicesListUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = InvoicesListUiState.Loading
            _uiState.value = when (val result = repository.getInvoices()) {
                is InvoicesResult.Loaded -> {
                    if (result.invoices.isEmpty()) {
                        InvoicesListUiState.Empty("No invoices yet")
                    } else {
                        InvoicesListUiState.Loaded(result.invoices)
                    }
                }
                is InvoicesResult.Error -> InvoicesListUiState.Error(result.message)
            }
        }
    }
}

sealed interface InvoiceDetailUiState {
    data object Loading : InvoiceDetailUiState
    data class Loaded(val detail: InvoiceDetail) : InvoiceDetailUiState
    data class Error(val message: String) : InvoiceDetailUiState
}

sealed interface PaymentHistoryUiState {
    data object Loading : PaymentHistoryUiState
    data class Loaded(val payments: List<InvoicePayment>) : PaymentHistoryUiState
    data class Error(val message: String) : PaymentHistoryUiState
}

@HiltViewModel
class InvoiceDetailViewModel @Inject constructor(
    private val repository: InvoicesRepository,
    private val authRepository: AuthRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val invoiceId: String = checkNotNull(savedStateHandle["invoiceId"])

    private val _detailState = MutableStateFlow<InvoiceDetailUiState>(InvoiceDetailUiState.Loading)
    val detailState: StateFlow<InvoiceDetailUiState> = _detailState.asStateFlow()

    private val _paymentsState = MutableStateFlow<PaymentHistoryUiState>(PaymentHistoryUiState.Loading)
    val paymentsState: StateFlow<PaymentHistoryUiState> = _paymentsState.asStateFlow()

    private val _pdfError = MutableStateFlow<String?>(null)
    val pdfError: StateFlow<String?> = _pdfError.asStateFlow()

    private val _pdfUri = MutableStateFlow<Uri?>(null)
    val pdfUri: StateFlow<Uri?> = _pdfUri.asStateFlow()

    private val _openingPdf = MutableStateFlow(false)
    val openingPdf: StateFlow<Boolean> = _openingPdf.asStateFlow()

    /** UI-layer only (see `canRecordPayment()`'s own doc comment) -- the server's own
     * `requireOrgRole(..., 'accountant')` on `POST /api/v1/invoices/:id/payments` remains the
     * real enforcement regardless of what this returns. `false` for a tenant caller (no
     * `organizations` at all), matching this pass's explicit "respect existing backend
     * authorization" instruction. */
    val canRecordPayment: Boolean
        get() = (authRepository.authState.value as? AuthState.Authenticated)
            ?.organizations?.firstOrNull()?.role?.let(::canRecordPayment) == true

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _detailState.value = InvoiceDetailUiState.Loading
            _detailState.value = when (val result = repository.getInvoice(invoiceId)) {
                is InvoiceDetailResult.Loaded -> InvoiceDetailUiState.Loaded(result.detail)
                is InvoiceDetailResult.Error -> InvoiceDetailUiState.Error(result.message)
            }
        }
        viewModelScope.launch {
            _paymentsState.value = PaymentHistoryUiState.Loading
            _paymentsState.value = when (val result = repository.getInvoicePayments(invoiceId)) {
                is InvoicePaymentsResult.Loaded -> PaymentHistoryUiState.Loaded(result.payments)
                is InvoicePaymentsResult.Error -> PaymentHistoryUiState.Error(result.message)
            }
        }
    }

    /** Refreshes both the header (paid/balance/status) and payment history after a payment is
     * recorded -- never locally increments `paid`/decrements `balance` itself, always re-fetches
     * the server's own new truth. */
    fun onPaymentRecorded() = load()

    fun openPdf() {
        if (_openingPdf.value) return
        _openingPdf.value = true
        _pdfError.value = null
        viewModelScope.launch {
            when (val result = repository.downloadInvoicePdf(invoiceId)) {
                is InvoicePdfResult.Success -> _pdfUri.value = result.fileUri
                is InvoicePdfResult.Error -> _pdfError.value = result.message
            }
            _openingPdf.value = false
        }
    }

    fun consumePdfUri() {
        _pdfUri.value = null
    }
}

sealed interface RecordPaymentUiState {
    data object Idle : RecordPaymentUiState
    data object Submitting : RecordPaymentUiState
    data object Success : RecordPaymentUiState
    data class Error(val message: String) : RecordPaymentUiState
}

/** Only ever reachable from a screen `InvoiceDetailViewModel.canRecordPayment` already gated --
 * see that property's own doc comment for why this is a UX nicety, not the real authorization. */
@HiltViewModel
class RecordPaymentViewModel @Inject constructor(
    private val repository: InvoicesRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val invoiceId: String = checkNotNull(savedStateHandle["invoiceId"])

    private val _uiState = MutableStateFlow<RecordPaymentUiState>(RecordPaymentUiState.Idle)
    val uiState: StateFlow<RecordPaymentUiState> = _uiState.asStateFlow()

    fun submit(amount: Double, paidAt: String, method: String, reference: String?, notes: String?) {
        if (_uiState.value == RecordPaymentUiState.Submitting) return
        _uiState.value = RecordPaymentUiState.Submitting
        viewModelScope.launch {
            val result = repository.recordPayment(
                invoiceId,
                RecordPaymentInput(amount = amount, paidAt = paidAt, method = method, reference = reference, notes = notes),
            )
            _uiState.value = when (result) {
                is RecordPaymentResult.Success -> RecordPaymentUiState.Success
                is RecordPaymentResult.Error -> RecordPaymentUiState.Error(result.message)
            }
        }
    }
}
