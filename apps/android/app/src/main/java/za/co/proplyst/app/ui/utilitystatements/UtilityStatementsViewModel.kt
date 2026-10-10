package za.co.proplyst.app.ui.utilitystatements

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import za.co.proplyst.app.data.utilitystatements.UtilityStatement
import za.co.proplyst.app.data.utilitystatements.UtilityStatementsRepository
import za.co.proplyst.app.data.utilitystatements.UtilityStatementsResult
import javax.inject.Inject

sealed interface UtilityStatementsUiState {
    data object Loading : UtilityStatementsUiState
    data object Empty : UtilityStatementsUiState
    data class Loaded(val statements: List<UtilityStatement>) : UtilityStatementsUiState
    data class Error(val message: String) : UtilityStatementsUiState
}

@HiltViewModel
class UtilityStatementsViewModel @Inject constructor(
    private val repository: UtilityStatementsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<UtilityStatementsUiState>(UtilityStatementsUiState.Loading)
    val uiState: StateFlow<UtilityStatementsUiState> = _uiState.asStateFlow()

    private val _expandedId = MutableStateFlow<String?>(null)
    val expandedId: StateFlow<String?> = _expandedId.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = UtilityStatementsUiState.Loading
            _uiState.value = when (val result = repository.getMyStatements()) {
                is UtilityStatementsResult.Loaded ->
                    if (result.statements.isEmpty()) UtilityStatementsUiState.Empty
                    else UtilityStatementsUiState.Loaded(result.statements)
                is UtilityStatementsResult.Error -> UtilityStatementsUiState.Error(result.message)
            }
        }
    }

    fun toggle(statementId: String) {
        _expandedId.value = if (_expandedId.value == statementId) null else statementId
    }
}
