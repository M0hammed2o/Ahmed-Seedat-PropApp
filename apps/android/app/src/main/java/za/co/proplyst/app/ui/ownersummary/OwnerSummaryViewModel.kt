package za.co.proplyst.app.ui.ownersummary

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.data.ownersummary.OwnerSummary
import za.co.proplyst.app.data.ownersummary.OwnerSummaryRepository
import za.co.proplyst.app.data.ownersummary.OwnerSummaryResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface OwnerSummaryUiState {
    data object Loading : OwnerSummaryUiState
    data object Empty : OwnerSummaryUiState
    data class Loaded(val summaries: List<OwnerSummary>) : OwnerSummaryUiState
    data class Error(val message: String) : OwnerSummaryUiState
}

@HiltViewModel
class OwnerSummaryViewModel @Inject constructor(
    private val repository: OwnerSummaryRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<OwnerSummaryUiState>(OwnerSummaryUiState.Loading)
    val uiState: StateFlow<OwnerSummaryUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = OwnerSummaryUiState.Loading
            _uiState.value = when (val result = repository.getMySummaries()) {
                is OwnerSummaryResult.Loaded ->
                    if (result.summaries.isEmpty()) OwnerSummaryUiState.Empty
                    else OwnerSummaryUiState.Loaded(result.summaries)
                is OwnerSummaryResult.Error -> OwnerSummaryUiState.Error(result.message)
            }
        }
    }
}
