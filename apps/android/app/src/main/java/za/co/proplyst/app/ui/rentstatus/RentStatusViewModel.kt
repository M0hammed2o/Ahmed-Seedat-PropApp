package za.co.proplyst.app.ui.rentstatus

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.data.financials.FinancialSummaryRepository
import za.co.proplyst.app.data.financials.TenantPaymentStatusResult
import za.co.proplyst.app.data.financials.TenantPaymentStatusRow
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

/** V1 utilities/rates/levies/budgets pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6, explicitly
 * "required on Android owner mobile"). Server-authoritative -- every row's status comes straight
 * from rent_schedules.status via /api/v1/properties/:id/tenant-payment-status; never inferred from
 * payment_reports here. */
enum class RentStatusFilter(val label: String) {
    ALL("All"),
    PAID("Paid"),
    PARTIAL("Partial"),
    UNPAID("Unpaid"),
    OVERDUE("Overdue"),
}

sealed interface RentStatusUiState {
    data object Loading : RentStatusUiState
    data object NoProperties : RentStatusUiState
    data class Error(val message: String) : RentStatusUiState
    data class Loaded(val rows: List<TenantPaymentStatusRow>) : RentStatusUiState
}

@HiltViewModel
class RentStatusViewModel @Inject constructor(
    private val financialSummaryRepository: FinancialSummaryRepository,
    private val propertiesRepository: PropertiesRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<RentStatusUiState>(RentStatusUiState.Loading)
    val uiState: StateFlow<RentStatusUiState> = _uiState.asStateFlow()

    private val _properties = MutableStateFlow<List<Property>>(emptyList())
    val properties: StateFlow<List<Property>> = _properties.asStateFlow()

    private val _selectedPropertyId = MutableStateFlow<String?>(null)
    val selectedPropertyId: StateFlow<String?> = _selectedPropertyId.asStateFlow()

    private val _filter = MutableStateFlow(RentStatusFilter.ALL)
    val filter: StateFlow<RentStatusFilter> = _filter.asStateFlow()

    private val _month = MutableStateFlow(currentMonthIso())
    val month: StateFlow<String> = _month.asStateFlow()

    init {
        loadProperties()
    }

    private fun loadProperties() {
        viewModelScope.launch {
            val properties = when (val result = propertiesRepository.getProperties()) {
                is PropertiesResult.Live -> result.properties
                is PropertiesResult.Cached -> result.properties
                is PropertiesResult.Error -> {
                    _uiState.value = RentStatusUiState.Error(result.message)
                    return@launch
                }
            }
            _properties.value = properties
            val first = properties.firstOrNull()
            if (first == null) {
                _uiState.value = RentStatusUiState.NoProperties
            } else {
                _selectedPropertyId.value = first.id
                loadRentStatus()
            }
        }
    }

    fun selectProperty(propertyId: String) {
        if (propertyId == _selectedPropertyId.value) return
        _selectedPropertyId.value = propertyId
        loadRentStatus()
    }

    fun setFilter(filter: RentStatusFilter) {
        _filter.value = filter
    }

    fun loadRentStatus() {
        val propertyId = _selectedPropertyId.value ?: return
        viewModelScope.launch {
            _uiState.value = RentStatusUiState.Loading
            when (val result = financialSummaryRepository.getTenantPaymentStatus(propertyId, _month.value)) {
                is TenantPaymentStatusResult.Loaded -> _uiState.value = RentStatusUiState.Loaded(result.rows)
                is TenantPaymentStatusResult.Error -> _uiState.value = RentStatusUiState.Error(result.message)
            }
        }
    }
}

private fun currentMonthIso(): String {
    val now = LocalDate.now()
    return LocalDate.of(now.year, now.month, 1).toString()
}
