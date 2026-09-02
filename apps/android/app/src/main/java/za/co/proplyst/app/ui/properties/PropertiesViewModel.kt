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

/** Properties grid filter chips (design handoff: "All / Residential / Commercial / Land") --
 * mapped from the real `Property.propertyType` values (`packages/types/src/enums.ts`
 * PROPERTY_TYPES), not a new taxonomy invented for this screen. */
enum class PropertyCategoryFilter { ALL, RESIDENTIAL, COMMERCIAL, LAND }

@HiltViewModel
class PropertiesListViewModel @Inject constructor(
    private val repository: PropertiesRepository,
) : ViewModel() {

    private var rawProperties: List<Property> = emptyList()
    private var cachedAtLabel: String? = null

    private val _uiState = MutableStateFlow<PropertiesListUiState>(PropertiesListUiState.Loading)
    val uiState: StateFlow<PropertiesListUiState> = _uiState.asStateFlow()

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _categoryFilter = MutableStateFlow(PropertyCategoryFilter.ALL)
    val categoryFilter: StateFlow<PropertyCategoryFilter> = _categoryFilter.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = PropertiesListUiState.Loading
            when (val result = repository.getProperties()) {
                is PropertiesResult.Live -> {
                    rawProperties = result.properties
                    cachedAtLabel = null
                }
                is PropertiesResult.Cached -> {
                    rawProperties = result.properties
                    cachedAtLabel = DateFormat.getDateTimeInstance().format(Date(result.fetchedAtEpochMillis))
                }
                is PropertiesResult.Error -> {
                    _uiState.value = PropertiesListUiState.Error(result.message)
                    return@launch
                }
            }
            applyFilters()
        }
    }

    fun onSearchQueryChange(query: String) {
        _searchQuery.value = query
        applyFilters()
    }

    fun onCategoryFilterChange(filter: PropertyCategoryFilter) {
        _categoryFilter.value = filter
        applyFilters()
    }

    private fun applyFilters() {
        val query = _searchQuery.value.trim().lowercase()
        val filter = _categoryFilter.value
        val filtered = rawProperties.filter { property ->
            val matchesQuery = query.isBlank() ||
                property.nickname.lowercase().contains(query) ||
                property.fullAddress.lowercase().contains(query)
            val matchesCategory = when (filter) {
                PropertyCategoryFilter.ALL -> true
                PropertyCategoryFilter.RESIDENTIAL -> property.propertyType in RESIDENTIAL_TYPES
                PropertyCategoryFilter.COMMERCIAL -> property.propertyType in COMMERCIAL_TYPES
                PropertyCategoryFilter.LAND -> property.propertyType == "vacant_land"
            }
            matchesQuery && matchesCategory
        }
        _uiState.value = when {
            filtered.isNotEmpty() -> PropertiesListUiState.Loaded(filtered, cachedAtLabel)
            rawProperties.isEmpty() -> PropertiesListUiState.Empty("No properties yet")
            else -> PropertiesListUiState.Empty("No properties match your search")
        }
    }

    private companion object {
        val RESIDENTIAL_TYPES = setOf("house", "apartment", "apartment_building", "townhouse", "student_accommodation")
        val COMMERCIAL_TYPES = setOf("commercial", "retail", "office", "industrial", "mixed_use")
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
