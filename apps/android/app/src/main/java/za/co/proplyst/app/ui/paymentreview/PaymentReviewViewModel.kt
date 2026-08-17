package za.co.proplyst.app.ui.paymentreview

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.data.paymentreports.DocumentUrlResult
import za.co.proplyst.app.data.paymentreports.PaymentReport
import za.co.proplyst.app.data.paymentreports.PaymentReportsRepository
import za.co.proplyst.app.data.paymentreports.PaymentReportsResult
import za.co.proplyst.app.data.paymentreports.PaymentReviewResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Android V1 final gap-closure pass (WORKLOG.md this date), Phase 3 -- the owner/staff review
 * equivalent of the tenant portal's PaymentReportsViewModel. Same repository (RLS decides scope,
 * this ViewModel doesn't), separate UI state since the review screen needs busy-per-action and
 * an inline reject-reason prompt the tenant list never does. */
sealed interface PaymentReviewUiState {
    data object Loading : PaymentReviewUiState
    data object Empty : PaymentReviewUiState
    data class Loaded(val reports: List<PaymentReport>) : PaymentReviewUiState
    data class Error(val message: String) : PaymentReviewUiState
}

@HiltViewModel
class PaymentReviewViewModel @Inject constructor(
    private val repository: PaymentReportsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<PaymentReviewUiState>(PaymentReviewUiState.Loading)
    val uiState: StateFlow<PaymentReviewUiState> = _uiState.asStateFlow()

    private val _busyReportId = MutableStateFlow<String?>(null)
    val busyReportId: StateFlow<String?> = _busyReportId.asStateFlow()

    private val _actionError = MutableStateFlow<String?>(null)
    val actionError: StateFlow<String?> = _actionError.asStateFlow()

    private val _documentUrl = MutableStateFlow<String?>(null)
    val documentUrl: StateFlow<String?> = _documentUrl.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = PaymentReviewUiState.Loading
            _uiState.value = when (val result = repository.getMyPaymentReports()) {
                is PaymentReportsResult.Loaded -> {
                    if (result.reports.isEmpty()) {
                        PaymentReviewUiState.Empty
                    } else {
                        PaymentReviewUiState.Loaded(result.reports)
                    }
                }
                is PaymentReportsResult.Error -> PaymentReviewUiState.Error(result.message)
            }
        }
    }

    fun confirm(reportId: String) {
        _actionError.value = null
        _busyReportId.value = reportId
        viewModelScope.launch {
            when (val result = repository.confirmPaymentReport(reportId)) {
                is PaymentReviewResult.Success -> load()
                is PaymentReviewResult.Error -> _actionError.value = result.message
            }
            _busyReportId.value = null
        }
    }

    fun reject(reportId: String, reason: String) {
        if (reason.isBlank()) {
            _actionError.value = "A reason is required to reject a payment report."
            return
        }
        _actionError.value = null
        _busyReportId.value = reportId
        viewModelScope.launch {
            when (val result = repository.rejectPaymentReport(reportId, reason)) {
                is PaymentReviewResult.Success -> load()
                is PaymentReviewResult.Error -> _actionError.value = result.message
            }
            _busyReportId.value = null
        }
    }

    fun openDocument(documentId: String) {
        viewModelScope.launch {
            when (val result = repository.getDocumentUrl(documentId)) {
                is DocumentUrlResult.Success -> _documentUrl.value = result.signedUrl
                is DocumentUrlResult.Error -> _actionError.value = result.message
            }
        }
    }

    fun consumeDocumentUrl() {
        _documentUrl.value = null
    }
}
