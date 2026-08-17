package za.co.proplyst.app.ui.leases

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.data.leases.Lease
import za.co.proplyst.app.data.leases.LeasesRepository
import za.co.proplyst.app.data.leases.LeasesResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date
import javax.inject.Inject

sealed interface LeasesListUiState {
    data object Loading : LeasesListUiState
    data class Empty(val message: String) : LeasesListUiState
    data class Loaded(val leases: List<Lease>, val cachedAt: String? = null) : LeasesListUiState
    data class Error(val message: String) : LeasesListUiState
}

@HiltViewModel
class LeasesListViewModel @Inject constructor(
    private val repository: LeasesRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val unitId: String = checkNotNull(savedStateHandle["unitId"])

    private val _uiState = MutableStateFlow<LeasesListUiState>(LeasesListUiState.Loading)
    val uiState: StateFlow<LeasesListUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = LeasesListUiState.Loading
            _uiState.value = when (val result = repository.getLeasesByUnit(unitId)) {
                is LeasesResult.Live -> {
                    if (result.leases.isEmpty()) {
                        LeasesListUiState.Empty("No leases yet")
                    } else {
                        LeasesListUiState.Loaded(result.leases)
                    }
                }
                is LeasesResult.Cached -> {
                    val formatted = DateFormat.getDateTimeInstance().format(Date(result.fetchedAtEpochMillis))
                    LeasesListUiState.Loaded(result.leases, cachedAt = formatted)
                }
                is LeasesResult.Error -> LeasesListUiState.Error(result.message)
            }
        }
    }
}

sealed interface LeaseDetailUiState {
    data object Loading : LeaseDetailUiState
    data class Loaded(val lease: Lease) : LeaseDetailUiState
    data object NotFound : LeaseDetailUiState
}

@HiltViewModel
class LeaseDetailViewModel @Inject constructor(
    private val repository: LeasesRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val leaseId: String = checkNotNull(savedStateHandle["leaseId"])

    private val _uiState = MutableStateFlow<LeaseDetailUiState>(LeaseDetailUiState.Loading)
    val uiState: StateFlow<LeaseDetailUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val lease = repository.getLeaseById(leaseId)
            _uiState.value = if (lease != null) LeaseDetailUiState.Loaded(lease) else LeaseDetailUiState.NotFound
        }
    }
}
