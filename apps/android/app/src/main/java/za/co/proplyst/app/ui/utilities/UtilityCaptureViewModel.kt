package za.co.proplyst.app.ui.utilities

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
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult
import za.co.proplyst.app.data.units.PropertyUnit
import za.co.proplyst.app.data.units.UnitsRepository
import za.co.proplyst.app.data.units.UnitsResult
import za.co.proplyst.app.data.utilities.UtilityHistoryPoint
import za.co.proplyst.app.data.utilities.UtilityHistoryResult
import za.co.proplyst.app.data.utilities.UtilityMeter
import za.co.proplyst.app.data.utilities.UtilityMetersResult
import za.co.proplyst.app.data.utilities.UtilityReadingSubmitResult
import za.co.proplyst.app.data.utilities.UtilitiesRepository
import java.time.LocalDate
import javax.inject.Inject

/** Owner Utility Capture (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6, §9-D). Never computes
 * "authoritative" consumption itself -- the previous reading shown and the eventual consumption
 * figure both come straight from the server (record_utility_reading()), matching §6's explicit
 * "do not calculate authoritative consumption differently from backend logic" rule. If the entered
 * reading is lower than the previous one, this screen surfaces that plainly rather than silently
 * correcting it -- meter reset/rollover is a known, documented V1 limitation
 * (UTILITIES_RATES_BUDGET_IMPLEMENTATION.md), not something guessed at here. */
data class UtilityCaptureFormState(
    val properties: List<Property> = emptyList(),
    val propertiesLoading: Boolean = true,
    val selectedPropertyId: String? = null,
    val units: List<PropertyUnit> = emptyList(),
    val selectedUnitId: String? = null,
    val utilityType: String = "water",
    val meters: List<UtilityMeter> = emptyList(),
    val metersLoading: Boolean = false,
    val selectedMeterId: String? = null,
    val previousReading: Double? = null,
    val previousLoading: Boolean = false,
    val readingValue: String = "",
    val readingDate: String = LocalDate.now().toString(),
    val notes: String = "",
    val evidenceUri: Uri? = null,
    val submitting: Boolean = false,
    val submitted: Boolean = false,
    val fieldError: String? = null,
    val submitError: String? = null,
) {
    val filteredMeters: List<UtilityMeter> get() = meters.filter { it.utilityType == utilityType }
    val enteredConsumption: Double?
        get() {
            val current = readingValue.toDoubleOrNull() ?: return null
            val previous = previousReading ?: return null
            return current - previous
        }
    val readingIsLowerThanPrevious: Boolean
        get() {
            val current = readingValue.toDoubleOrNull() ?: return false
            val previous = previousReading ?: return false
            return current < previous
        }
}

@HiltViewModel
class UtilityCaptureViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val propertiesRepository: PropertiesRepository,
    private val unitsRepository: UnitsRepository,
    private val utilitiesRepository: UtilitiesRepository,
) : ViewModel() {

    private val _formState = MutableStateFlow(UtilityCaptureFormState())
    val formState: StateFlow<UtilityCaptureFormState> = _formState.asStateFlow()

    private fun currentOrgId(): String? =
        (authRepository.authState.value as? AuthState.Authenticated)?.organizations?.firstOrNull()?.orgId

    init {
        loadProperties()
    }

    private fun loadProperties() {
        viewModelScope.launch {
            _formState.value = _formState.value.copy(propertiesLoading = true)
            val properties = when (val result = propertiesRepository.getProperties()) {
                is PropertiesResult.Live -> result.properties
                is PropertiesResult.Cached -> result.properties
                is PropertiesResult.Error -> emptyList()
            }
            val first = properties.firstOrNull()
            _formState.value = _formState.value.copy(
                properties = properties,
                propertiesLoading = false,
                selectedPropertyId = first?.id,
            )
            if (first != null) {
                loadUnits(first.id)
                loadMeters(first.id, null)
            }
        }
    }

    fun selectProperty(propertyId: String) {
        _formState.value = _formState.value.copy(
            selectedPropertyId = propertyId, selectedUnitId = null, units = emptyList(),
            meters = emptyList(), selectedMeterId = null, previousReading = null,
        )
        loadUnits(propertyId)
        loadMeters(propertyId, null)
    }

    private fun loadUnits(propertyId: String) {
        viewModelScope.launch {
            val units = when (val result = unitsRepository.getUnitsByProperty(propertyId)) {
                is UnitsResult.Live -> result.units
                is UnitsResult.Cached -> result.units
                is UnitsResult.Error -> emptyList()
            }
            _formState.value = _formState.value.copy(units = units)
        }
    }

    fun selectUnit(unitId: String?) {
        _formState.value = _formState.value.copy(selectedUnitId = unitId, selectedMeterId = null, previousReading = null)
        _formState.value.selectedPropertyId?.let { loadMeters(it, unitId) }
    }

    fun selectUtilityType(utilityType: String) {
        _formState.value = _formState.value.copy(utilityType = utilityType, selectedMeterId = null, previousReading = null)
    }

    private fun loadMeters(propertyId: String, unitId: String?) {
        viewModelScope.launch {
            _formState.value = _formState.value.copy(metersLoading = true)
            val meters = when (val result = utilitiesRepository.getMeters(propertyId, unitId)) {
                is UtilityMetersResult.Loaded -> result.meters
                is UtilityMetersResult.Error -> emptyList()
            }
            val firstMatching = meters.firstOrNull { it.utilityType == _formState.value.utilityType }
            _formState.value = _formState.value.copy(meters = meters, metersLoading = false, selectedMeterId = firstMatching?.id)
            if (firstMatching != null) loadPreviousReading(firstMatching.id)
        }
    }

    fun selectMeter(meterId: String) {
        _formState.value = _formState.value.copy(selectedMeterId = meterId)
        loadPreviousReading(meterId)
    }

    private fun loadPreviousReading(meterId: String) {
        viewModelScope.launch {
            _formState.value = _formState.value.copy(previousLoading = true)
            val history: List<UtilityHistoryPoint> = when (val result = utilitiesRepository.getReadingHistory(meterId)) {
                is UtilityHistoryResult.Loaded -> result.history
                is UtilityHistoryResult.Error -> emptyList()
            }
            _formState.value = _formState.value.copy(
                previousReading = history.lastOrNull()?.readingValue,
                previousLoading = false,
            )
        }
    }

    fun setReadingValue(value: String) {
        _formState.value = _formState.value.copy(readingValue = value, fieldError = null)
    }

    fun setReadingDate(value: String) {
        _formState.value = _formState.value.copy(readingDate = value)
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
        val meterId = state.selectedMeterId
        val value = state.readingValue.toDoubleOrNull()
        val error = when {
            orgId == null || propertyId == null -> "Select a property first."
            meterId == null -> "Select a meter first."
            value == null || value < 0 -> "Enter a valid reading."
            state.readingDate.isBlank() -> "Enter a reading date."
            else -> null
        }
        if (error != null) {
            _formState.value = state.copy(fieldError = error)
            return
        }

        _formState.value = state.copy(submitting = true, submitError = null, fieldError = null)
        viewModelScope.launch {
            val periodMonth = state.readingDate.take(7) + "-01"
            val unitOfMeasure = if (state.utilityType == "water") "L" else "kWh"
            val result = utilitiesRepository.recordReading(
                orgId = orgId!!,
                propertyId = propertyId!!,
                meterId = meterId!!,
                utilityType = state.utilityType,
                periodMonth = periodMonth,
                readingDate = state.readingDate,
                readingValue = value!!,
                unitOfMeasure = unitOfMeasure,
                evidenceUri = state.evidenceUri,
                notes = state.notes.ifBlank { null },
            )
            _formState.value = when (result) {
                is UtilityReadingSubmitResult.Success -> _formState.value.copy(submitting = false, submitted = true)
                is UtilityReadingSubmitResult.Error -> _formState.value.copy(submitting = false, submitError = result.message)
            }
        }
    }
}
