package za.co.proplyst.app.ui.properties

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date
import javax.inject.Inject

sealed interface PropertiesListUiState {
    data object Loading : PropertiesListUiState
    data class Empty(val message: String) : PropertiesListUiState
    data class Loaded(val properties: List<Property>, val cachedAt: String? = null) : PropertiesListUiState
    data class Error(val message: String) : PropertiesListUiState
}

@HiltViewModel
class PropertiesListViewModel @Inject constructor(
    private val repository: PropertiesRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<PropertiesListUiState>(PropertiesListUiState.Loading)
    val uiState: StateFlow<PropertiesListUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = PropertiesListUiState.Loading
            _uiState.value = when (val result = repository.getProperties()) {
                is PropertiesResult.Live -> {
                    if (result.properties.isEmpty()) {
                        PropertiesListUiState.Empty("No properties yet")
                    } else {
                        PropertiesListUiState.Loaded(result.properties)
                    }
                }
                is PropertiesResult.Cached -> {
                    val formatted = DateFormat.getDateTimeInstance().format(Date(result.fetchedAtEpochMillis))
                    PropertiesListUiState.Loaded(result.properties, cachedAt = formatted)
                }
                is PropertiesResult.Error -> PropertiesListUiState.Error(result.message)
            }
        }
    }
}

sealed interface PropertyDetailUiState {
    data object Loading : PropertyDetailUiState
    data class Loaded(val property: Property) : PropertyDetailUiState
    data object NotFound : PropertyDetailUiState
}

@HiltViewModel
class PropertyDetailViewModel @Inject constructor(
    private val repository: PropertiesRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val propertyId: String = checkNotNull(savedStateHandle["propertyId"])

    private val _uiState = MutableStateFlow<PropertyDetailUiState>(PropertyDetailUiState.Loading)
    val uiState: StateFlow<PropertyDetailUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val property = repository.getPropertyById(propertyId)
            _uiState.value = if (property != null) {
                PropertyDetailUiState.Loaded(property)
            } else {
                PropertyDetailUiState.NotFound
            }
        }
    }
}
