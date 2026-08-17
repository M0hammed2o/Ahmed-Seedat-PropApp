package za.co.proplyst.app.ui.paymentreports

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.data.paymentreports.PaymentReport
import za.co.proplyst.app.data.paymentreports.PaymentReportsRepository
import za.co.proplyst.app.data.paymentreports.PaymentReportsResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface PaymentReportsListUiState {
    data object Loading : PaymentReportsListUiState
    data object Empty : PaymentReportsListUiState
    data class Loaded(val reports: List<PaymentReport>) : PaymentReportsListUiState
    data class Error(val message: String) : PaymentReportsListUiState
}

@HiltViewModel
class PaymentReportsViewModel @Inject constructor(
    private val repository: PaymentReportsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<PaymentReportsListUiState>(PaymentReportsListUiState.Loading)
    val uiState: StateFlow<PaymentReportsListUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = PaymentReportsListUiState.Loading
            _uiState.value = when (val result = repository.getMyPaymentReports()) {
                is PaymentReportsResult.Loaded -> {
                    if (result.reports.isEmpty()) {
                        PaymentReportsListUiState.Empty
                    } else {
                        PaymentReportsListUiState.Loaded(result.reports)
                    }
                }
                is PaymentReportsResult.Error -> PaymentReportsListUiState.Error(result.message)
            }
        }
    }
}
