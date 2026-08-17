package com.propertyvault.app.ui.paymentreports

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.propertyvault.app.data.paymentreports.PaymentReportsRepository
import com.propertyvault.app.data.paymentreports.ReportPaymentInput
import com.propertyvault.app.data.paymentreports.ReportPaymentResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ReportPaymentFormState(
    val amount: String = "",
    val paymentMethod: String = "eft",
    val paymentDate: String = "",
    val proofUri: Uri? = null,
    val submitting: Boolean = false,
    val error: String? = null,
    val submitted: Boolean = false,
)

@HiltViewModel
class ReportPaymentViewModel @Inject constructor(
    private val repository: PaymentReportsRepository,
) : ViewModel() {

    private val _formState = MutableStateFlow(ReportPaymentFormState())
    val formState: StateFlow<ReportPaymentFormState> = _formState.asStateFlow()

    fun setAmount(value: String) {
        _formState.value = _formState.value.copy(amount = value, error = null)
    }

    fun setPaymentMethod(value: String) {
        _formState.value = _formState.value.copy(paymentMethod = value, error = null)
    }

    fun setPaymentDate(value: String) {
        _formState.value = _formState.value.copy(paymentDate = value, error = null)
    }

    fun setProofUri(uri: Uri?) {
        _formState.value = _formState.value.copy(proofUri = uri)
    }

    fun submit() {
        val state = _formState.value
        val amount = state.amount.toDoubleOrNull()
        if (amount == null || amount <= 0) {
            _formState.value = state.copy(error = "Enter a valid amount.")
            return
        }
        if (state.paymentDate.isBlank()) {
            _formState.value = state.copy(error = "Enter a payment date.")
            return
        }

        _formState.value = state.copy(submitting = true, error = null)
        viewModelScope.launch {
            val result = repository.reportPayment(
                ReportPaymentInput(
                    amount = amount,
                    paymentMethod = state.paymentMethod,
                    paymentDate = state.paymentDate,
                    proofUri = state.proofUri,
                ),
            )
            _formState.value = when (result) {
                is ReportPaymentResult.Success -> _formState.value.copy(submitting = false, submitted = true)
                is ReportPaymentResult.Error -> _formState.value.copy(submitting = false, error = result.message)
            }
        }
    }
}
