package za.co.proplyst.app.ui.maintenance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.data.maintenance.CreateMaintenanceTicketResult
import za.co.proplyst.app.data.maintenance.MaintenanceRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Tenant maintenance ticket submission (Android V1 final gap-closure pass, WORKLOG.md this
 * date, Phase 4) -- same form-state shape as ReportPaymentViewModel. No photo/file attachment:
 * see MaintenanceRepository's doc comment for why (backend schema has no attachment field yet). */
data class CreateMaintenanceTicketFormState(
    val summary: String = "",
    val description: String = "",
    val priority: String = "medium",
    val submitting: Boolean = false,
    val error: String? = null,
    val submitted: Boolean = false,
)

@HiltViewModel
class CreateMaintenanceTicketViewModel @Inject constructor(
    private val repository: MaintenanceRepository,
) : ViewModel() {

    private val _formState = MutableStateFlow(CreateMaintenanceTicketFormState())
    val formState: StateFlow<CreateMaintenanceTicketFormState> = _formState.asStateFlow()

    fun setSummary(value: String) {
        _formState.value = _formState.value.copy(summary = value, error = null)
    }

    fun setDescription(value: String) {
        _formState.value = _formState.value.copy(description = value)
    }

    fun setPriority(value: String) {
        _formState.value = _formState.value.copy(priority = value)
    }

    fun submit() {
        val state = _formState.value
        if (state.summary.isBlank()) {
            _formState.value = state.copy(error = "Describe the issue in a few words.")
            return
        }

        _formState.value = state.copy(submitting = true, error = null)
        viewModelScope.launch {
            val result = repository.createTicket(
                summary = state.summary,
                description = state.description.ifBlank { null },
                priority = state.priority,
            )
            _formState.value = when (result) {
                is CreateMaintenanceTicketResult.Success -> _formState.value.copy(submitting = false, submitted = true)
                is CreateMaintenanceTicketResult.Error -> _formState.value.copy(submitting = false, error = result.message)
            }
        }
    }
}
