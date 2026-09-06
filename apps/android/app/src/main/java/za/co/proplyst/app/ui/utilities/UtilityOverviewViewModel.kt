package za.co.proplyst.app.ui.utilities

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import za.co.proplyst.app.data.financials.FinancialSummaryRepository
import za.co.proplyst.app.data.financials.FinancialSummaryResult
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult
import za.co.proplyst.app.data.utilities.UtilityHistoryPoint
import za.co.proplyst.app.data.utilities.UtilityHistoryResult
import za.co.proplyst.app.data.utilities.UtilityMeter
import za.co.proplyst.app.data.utilities.UtilityMetersResult
import za.co.proplyst.app.data.utilities.UtilitiesRepository
import java.time.LocalDate
import javax.inject.Inject

/** Owner Utility Overview (V1 owner-app completion pass, WORKLOG.md this date) -- the daily-use
 * "how are my meters doing" screen, distinct from Utility Capture (record a reading) and Utility
 * History (one meter's trend). Every figure comes straight from the same server-computed sources
 * those two screens already use: [UtilityHistoryPoint]'s own `consumption`/`previousConsumption`/
 * `percentChange`/`isUnusualUsage` fields (never recomputed on-device -- matches
 * UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6's "do not calculate authoritative consumption differently
 * from backend logic"), and the property's own [za.co.proplyst.app.data.financials.FinancialSummary]
 * for the "owner cost this month" figures (there is no per-meter cost source; the property-level
 * water/electricity expense total is the real, non-fabricated number). */
data class UtilityMeterCard(
    val meter: UtilityMeter,
    val lastReadingValue: Double?,
    val lastReadingPeriod: String?,
    val currentPeriodUsage: Double?,
    val previousPeriodUsage: Double?,
    val percentChange: Double?,
    val isUnusualUsage: Boolean,
)

data class UtilityOverviewUiState(
    val properties: List<Property> = emptyList(),
    val propertiesLoading: Boolean = true,
    val selectedPropertyId: String? = null,
    val metersLoading: Boolean = false,
    val waterMeters: List<UtilityMeterCard> = emptyList(),
    val electricityMeters: List<UtilityMeterCard> = emptyList(),
    /** Property's total water/electricity expense this month -- only meaningful (and only shown
     * by the UI) when at least one meter of that type is actually owner-paid; a tenant-prepaid or
     * included-in-rent meter must never be shown next to a cost the owner didn't incur. */
    val waterExpenseThisMonth: Double? = null,
    val electricityExpenseThisMonth: Double? = null,
    val error: String? = null,
) {
    val selectedProperty: Property? get() = properties.firstOrNull { it.id == selectedPropertyId }
}

private fun isOwnerCostResponsibility(mode: String) = mode == "owner_paid" || mode == "common_area_owner"

@HiltViewModel
class UtilityOverviewViewModel @Inject constructor(
    private val propertiesRepository: PropertiesRepository,
    private val utilitiesRepository: UtilitiesRepository,
    private val financialSummaryRepository: FinancialSummaryRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(UtilityOverviewUiState())
    val uiState: StateFlow<UtilityOverviewUiState> = _uiState.asStateFlow()

    init {
        loadProperties()
    }

    private fun loadProperties() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(propertiesLoading = true)
            val properties = when (val result = propertiesRepository.getProperties()) {
                is PropertiesResult.Live -> result.properties
                is PropertiesResult.Cached -> result.properties
                is PropertiesResult.Error -> emptyList()
            }
            val first = properties.firstOrNull()
            _uiState.value = _uiState.value.copy(
                properties = properties,
                propertiesLoading = false,
                selectedPropertyId = first?.id,
                error = if (properties.isEmpty()) "No properties yet" else null,
            )
            if (first != null) loadForProperty(first.id)
        }
    }

    fun selectProperty(propertyId: String) {
        if (propertyId == _uiState.value.selectedPropertyId) return
        _uiState.value = _uiState.value.copy(
            selectedPropertyId = propertyId,
            waterMeters = emptyList(),
            electricityMeters = emptyList(),
            waterExpenseThisMonth = null,
            electricityExpenseThisMonth = null,
        )
        loadForProperty(propertyId)
    }

    fun retry() {
        val propertyId = _uiState.value.selectedPropertyId
        if (propertyId != null) loadForProperty(propertyId) else loadProperties()
    }

    private fun loadForProperty(propertyId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(metersLoading = true, error = null)

            val meters = when (val result = utilitiesRepository.getMeters(propertyId, null)) {
                is UtilityMetersResult.Loaded -> result.meters.filter { it.active }
                is UtilityMetersResult.Error -> {
                    _uiState.value = _uiState.value.copy(metersLoading = false, error = result.message)
                    return@launch
                }
            }

            val cards = meters.map { meter -> async { buildCard(meter) } }.awaitAll()
            val waterCards = cards.filter { it.meter.utilityType == "water" }
            val electricityCards = cards.filter { it.meter.utilityType == "electricity" }

            var waterExpense: Double? = null
            var electricityExpense: Double? = null
            val waterHasOwnerCost = meters.any { it.utilityType == "water" && isOwnerCostResponsibility(it.responsibilityMode) }
            val electricityHasOwnerCost = meters.any { it.utilityType == "electricity" && isOwnerCostResponsibility(it.responsibilityMode) }
            if (waterHasOwnerCost || electricityHasOwnerCost) {
                when (val result = financialSummaryRepository.getFinancialSummary(propertyId, currentMonthIso())) {
                    is FinancialSummaryResult.Loaded -> {
                        if (waterHasOwnerCost) waterExpense = result.summary.waterExpense
                        if (electricityHasOwnerCost) electricityExpense = result.summary.electricityExpense
                    }
                    is FinancialSummaryResult.Error -> Unit
                }
            }

            _uiState.value = _uiState.value.copy(
                metersLoading = false,
                waterMeters = waterCards,
                electricityMeters = electricityCards,
                waterExpenseThisMonth = waterExpense,
                electricityExpenseThisMonth = electricityExpense,
            )
        }
    }

    private suspend fun buildCard(meter: UtilityMeter): UtilityMeterCard {
        val history: List<UtilityHistoryPoint> = when (val result = utilitiesRepository.getReadingHistory(meter.id)) {
            is UtilityHistoryResult.Loaded -> result.history
            is UtilityHistoryResult.Error -> emptyList()
        }
        val latest = history.lastOrNull()
        return UtilityMeterCard(
            meter = meter,
            lastReadingValue = latest?.readingValue,
            lastReadingPeriod = latest?.periodMonth,
            currentPeriodUsage = latest?.consumption,
            previousPeriodUsage = latest?.previousConsumption,
            percentChange = latest?.percentChange,
            isUnusualUsage = latest?.isUnusualUsage ?: false,
        )
    }

    private fun currentMonthIso(): String {
        val now = LocalDate.now()
        return LocalDate.of(now.year, now.month, 1).toString()
    }
}
