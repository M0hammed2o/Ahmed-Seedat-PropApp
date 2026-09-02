package za.co.proplyst.app.ui.utilities

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult
import za.co.proplyst.app.data.utilities.UtilityHistoryPoint
import za.co.proplyst.app.data.utilities.UtilityHistoryResult
import za.co.proplyst.app.data.utilities.UtilityMeter
import za.co.proplyst.app.data.utilities.UtilityMetersResult
import za.co.proplyst.app.data.utilities.UtilitiesRepository
import javax.inject.Inject

/** Owner Utility History (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §7, §9-F). Every figure (usage,
 * previous usage, % change, anomaly flag) comes straight from the server -- never recomputed here
 * (§7's own "do not require OCR" and the wider "server-authoritative" rule extend to this screen
 * too: it renders what the API already computed). */
data class UtilityHistoryScreenState(
    val properties: List<Property> = emptyList(),
    val propertiesLoading: Boolean = true,
    val selectedPropertyId: String? = null,
    val utilityType: String = "water",
    val meters: List<UtilityMeter> = emptyList(),
    val selectedMeterId: String? = null,
    val historyLoading: Boolean = false,
    val history: List<UtilityHistoryPoint> = emptyList(),
    val error: String? = null,
) {
    val filteredMeters: List<UtilityMeter> get() = meters.filter { it.utilityType == utilityType }
}

@HiltViewModel
class UtilityHistoryViewModel @Inject constructor(
    private val propertiesRepository: PropertiesRepository,
    private val utilitiesRepository: UtilitiesRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(UtilityHistoryScreenState())
    val state: StateFlow<UtilityHistoryScreenState> = _state.asStateFlow()

    init {
        loadProperties()
    }

    private fun loadProperties() {
        viewModelScope.launch {
            _state.value = _state.value.copy(propertiesLoading = true)
            val properties = when (val result = propertiesRepository.getProperties()) {
                is PropertiesResult.Live -> result.properties
                is PropertiesResult.Cached -> result.properties
                is PropertiesResult.Error -> emptyList()
            }
            val first = properties.firstOrNull()
            _state.value = _state.value.copy(properties = properties, propertiesLoading = false, selectedPropertyId = first?.id)
            if (first != null) loadMeters(first.id)
        }
    }

    fun selectProperty(propertyId: String) {
        _state.value = _state.value.copy(selectedPropertyId = propertyId, meters = emptyList(), selectedMeterId = null, history = emptyList())
        loadMeters(propertyId)
    }

    fun selectUtilityType(utilityType: String) {
        _state.value = _state.value.copy(utilityType = utilityType, selectedMeterId = null, history = emptyList())
        val firstMatching = _state.value.meters.firstOrNull { it.utilityType == utilityType }
        if (firstMatching != null) selectMeter(firstMatching.id)
    }

    private fun loadMeters(propertyId: String) {
        viewModelScope.launch {
            val meters = when (val result = utilitiesRepository.getMeters(propertyId, null)) {
                is UtilityMetersResult.Loaded -> result.meters
                is UtilityMetersResult.Error -> emptyList()
            }
            val firstMatching = meters.firstOrNull { it.utilityType == _state.value.utilityType }
            _state.value = _state.value.copy(meters = meters, selectedMeterId = firstMatching?.id)
            if (firstMatching != null) loadHistory(firstMatching.id)
        }
    }

    fun selectMeter(meterId: String) {
        _state.value = _state.value.copy(selectedMeterId = meterId)
        loadHistory(meterId)
    }

    private fun loadHistory(meterId: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(historyLoading = true, error = null)
            _state.value = when (val result = utilitiesRepository.getReadingHistory(meterId)) {
                is UtilityHistoryResult.Loaded -> _state.value.copy(historyLoading = false, history = result.history.reversed())
                is UtilityHistoryResult.Error -> _state.value.copy(historyLoading = false, error = result.message)
            }
        }
    }
}
