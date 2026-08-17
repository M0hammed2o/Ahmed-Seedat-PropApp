package za.co.proplyst.app.ui.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.data.notifications.AppNotification
import za.co.proplyst.app.data.notifications.MarkReadResult
import za.co.proplyst.app.data.notifications.NotificationsRepository
import za.co.proplyst.app.data.notifications.NotificationsResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface NotificationsUiState {
    data object Loading : NotificationsUiState
    data object Empty : NotificationsUiState
    data class Loaded(val notifications: List<AppNotification>) : NotificationsUiState
    data class Error(val message: String) : NotificationsUiState
}

@HiltViewModel
class NotificationsViewModel @Inject constructor(
    private val repository: NotificationsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<NotificationsUiState>(NotificationsUiState.Loading)
    val uiState: StateFlow<NotificationsUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = NotificationsUiState.Loading
            _uiState.value = when (val result = repository.getMyNotifications()) {
                is NotificationsResult.Loaded ->
                    if (result.notifications.isEmpty()) NotificationsUiState.Empty
                    else NotificationsUiState.Loaded(result.notifications)
                is NotificationsResult.Error -> NotificationsUiState.Error(result.message)
            }
        }
    }

    /** Marks read, then reloads -- simple and correct for a list this size; not optimistic-UI,
     * a real trade-off for this pass's time budget, not an oversight. */
    fun markRead(id: String) {
        viewModelScope.launch {
            when (repository.markRead(id)) {
                is MarkReadResult.Success -> load()
                is MarkReadResult.Error -> Unit // best-effort -- a failed mark-read isn't worth surfacing an error banner for
            }
        }
    }
}
