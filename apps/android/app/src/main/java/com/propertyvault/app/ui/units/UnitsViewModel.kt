package com.propertyvault.app.ui.units

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.propertyvault.app.data.units.PropertyUnit
import com.propertyvault.app.data.units.UnitsRepository
import com.propertyvault.app.data.units.UnitsResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date
import javax.inject.Inject

sealed interface UnitsListUiState {
    data object Loading : UnitsListUiState
    data class Empty(val message: String) : UnitsListUiState
    data class Loaded(val units: List<PropertyUnit>, val cachedAt: String? = null) : UnitsListUiState
    data class Error(val message: String) : UnitsListUiState
}

@HiltViewModel
class UnitsListViewModel @Inject constructor(
    private val repository: UnitsRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val propertyId: String = checkNotNull(savedStateHandle["propertyId"])

    private val _uiState = MutableStateFlow<UnitsListUiState>(UnitsListUiState.Loading)
    val uiState: StateFlow<UnitsListUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = UnitsListUiState.Loading
            _uiState.value = when (val result = repository.getUnitsByProperty(propertyId)) {
                is UnitsResult.Live -> {
                    if (result.units.isEmpty()) {
                        UnitsListUiState.Empty("No units yet")
                    } else {
                        UnitsListUiState.Loaded(result.units)
                    }
                }
                is UnitsResult.Cached -> {
                    val formatted = DateFormat.getDateTimeInstance().format(Date(result.fetchedAtEpochMillis))
                    UnitsListUiState.Loaded(result.units, cachedAt = formatted)
                }
                is UnitsResult.Error -> UnitsListUiState.Error(result.message)
            }
        }
    }
}

sealed interface UnitDetailUiState {
    data object Loading : UnitDetailUiState
    data class Loaded(val unit: PropertyUnit) : UnitDetailUiState
    data object NotFound : UnitDetailUiState
}

@HiltViewModel
class UnitDetailViewModel @Inject constructor(
    private val repository: UnitsRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val unitId: String = checkNotNull(savedStateHandle["unitId"])

    private val _uiState = MutableStateFlow<UnitDetailUiState>(UnitDetailUiState.Loading)
    val uiState: StateFlow<UnitDetailUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val unit = repository.getUnitById(unitId)
            _uiState.value = if (unit != null) UnitDetailUiState.Loaded(unit) else UnitDetailUiState.NotFound
        }
    }
}
