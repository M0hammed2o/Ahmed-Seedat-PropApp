package za.co.proplyst.app.ui.expenses

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.AuthState
import za.co.proplyst.app.data.expenses.ExpenseCreateInput
import za.co.proplyst.app.data.expenses.ExpenseCreateResult
import za.co.proplyst.app.data.expenses.ExpensesRepository
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult
import za.co.proplyst.app.data.units.PropertyUnit
import za.co.proplyst.app.data.units.UnitsRepository
import za.co.proplyst.app.data.units.UnitsResult
import javax.inject.Inject

/** Owner Add Expense (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §5, §9-C). Reuses the existing
 * expenses architecture end to end -- creates exactly ONE authoritative expenses row, never a
 * second/duplicate financial record. */
data class AddExpenseFormState(
    val properties: List<Property> = emptyList(),
    val propertiesLoading: Boolean = true,
    val propertiesError: String? = null,
    val selectedPropertyId: String? = null,
    val units: List<PropertyUnit> = emptyList(),
    val selectedUnitId: String? = null,
    val category: String = "",
    val amount: String = "",
    val referenceNumber: String = "",
    val invoiceDate: String = "",
    val notes: String = "",
    val evidenceUri: Uri? = null,
    val submitting: Boolean = false,
    val submitted: Boolean = false,
    val fieldError: String? = null,
    val submitError: String? = null,
)

@HiltViewModel
class AddExpenseViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val propertiesRepository: PropertiesRepository,
    private val unitsRepository: UnitsRepository,
    private val expensesRepository: ExpensesRepository,
) : ViewModel() {

    private val _formState = MutableStateFlow(AddExpenseFormState())
    val formState: StateFlow<AddExpenseFormState> = _formState.asStateFlow()

    private fun currentOrgId(): String? =
        (authRepository.authState.value as? AuthState.Authenticated)?.organizations?.firstOrNull()?.orgId

    init {
        loadProperties()
    }

    private fun loadProperties() {
        viewModelScope.launch {
            _formState.value = _formState.value.copy(propertiesLoading = true, propertiesError = null)
            when (val result = propertiesRepository.getProperties()) {
                is PropertiesResult.Live -> onPropertiesLoaded(result.properties)
                is PropertiesResult.Cached -> onPropertiesLoaded(result.properties)
                is PropertiesResult.Error -> _formState.value =
                    _formState.value.copy(propertiesLoading = false, propertiesError = result.message)
            }
        }
    }

    private fun onPropertiesLoaded(properties: List<Property>) {
        val first = properties.firstOrNull()
        _formState.value = _formState.value.copy(
            properties = properties,
            propertiesLoading = false,
            selectedPropertyId = first?.id,
        )
        if (first != null) loadUnits(first.id)
    }

    fun selectProperty(propertyId: String) {
        _formState.value = _formState.value.copy(selectedPropertyId = propertyId, selectedUnitId = null, units = emptyList())
        loadUnits(propertyId)
    }

    private fun loadUnits(propertyId: String) {
        viewModelScope.launch {
            when (val result = unitsRepository.getUnitsByProperty(propertyId)) {
                is UnitsResult.Live -> _formState.value = _formState.value.copy(units = result.units)
                is UnitsResult.Cached -> _formState.value = _formState.value.copy(units = result.units)
                is UnitsResult.Error -> _formState.value = _formState.value.copy(units = emptyList())
            }
        }
    }

    fun selectUnit(unitId: String?) {
        _formState.value = _formState.value.copy(selectedUnitId = unitId)
    }

    fun setCategory(value: String) {
        _formState.value = _formState.value.copy(category = value, fieldError = null)
    }

    fun setAmount(value: String) {
        _formState.value = _formState.value.copy(amount = value, fieldError = null)
    }

    fun setReferenceNumber(value: String) {
        _formState.value = _formState.value.copy(referenceNumber = value)
    }

    fun setInvoiceDate(value: String) {
        _formState.value = _formState.value.copy(invoiceDate = value)
    }

    fun setNotes(value: String) {
        _formState.value = _formState.value.copy(notes = value)
    }

    fun setEvidenceUri(uri: Uri?) {
        _formState.value = _formState.value.copy(evidenceUri = uri)
    }

    fun submit() {
        val state = _formState.value
        val orgId = currentOrgId()
        val propertyId = state.selectedPropertyId
        val amount = state.amount.toDoubleOrNull()

        val error = when {
            orgId == null || propertyId == null -> "Select a property first."
            state.category.isBlank() -> "Enter or select a category."
            amount == null || amount <= 0 -> "Enter a valid amount."
            else -> null
        }
        if (error != null) {
            _formState.value = state.copy(fieldError = error)
            return
        }

        _formState.value = state.copy(submitting = true, submitError = null, fieldError = null)
        viewModelScope.launch {
            val result = expensesRepository.createExpense(
                ExpenseCreateInput(
                    orgId = orgId!!,
                    propertyId = propertyId!!,
                    unitId = state.selectedUnitId,
                    category = state.category.trim(),
                    amount = amount!!,
                    referenceNumber = state.referenceNumber.ifBlank { null },
                    invoiceDate = state.invoiceDate.ifBlank { null },
                    notes = state.notes.ifBlank { null },
                    evidenceUri = state.evidenceUri,
                ),
            )
            _formState.value = when (result) {
                is ExpenseCreateResult.Success -> _formState.value.copy(submitting = false, submitted = true)
                is ExpenseCreateResult.Error -> _formState.value.copy(submitting = false, submitError = result.message)
            }
        }
    }
}
