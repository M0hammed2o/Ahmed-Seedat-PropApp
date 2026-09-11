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
import java.time.Instant
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
            _uiState.value = fetch()
        }
    }

    /**
     * Reload without flashing the spinner, for the screen's resume effect.
     *
     * Activity is returned to constantly -- an owner opens a maintenance alert, closes the ticket,
     * comes back. Re-running [load] there would blank a full screen of history for the duration of
     * a network round trip, so this keeps the current list on screen and swaps it when the new one
     * arrives. A failure while we already have content is swallowed rather than replacing a good
     * list with an error page; the pull-to-retry path through [load] still surfaces it.
     */
    fun refresh() {
        viewModelScope.launch {
            val next = fetch()
            if (next is NotificationsUiState.Error && _uiState.value is NotificationsUiState.Loaded) return@launch
            _uiState.value = next
        }
    }

    private suspend fun fetch(): NotificationsUiState =
        when (val result = repository.getMyNotifications()) {
            is NotificationsResult.Loaded ->
                if (result.notifications.isEmpty()) NotificationsUiState.Empty
                else NotificationsUiState.Loaded(result.notifications)
            is NotificationsResult.Error -> NotificationsUiState.Error(result.message)
        }

    /**
     * Marks an activity read because the user opened it.
     *
     * READ, deliberately not RESOLVED and not DELETED. Opening a "rent overdue" activity says the
     * owner has seen it; it says nothing about whether the rent was paid. The row therefore stays
     * in the list as history and merely loses its unread styling -- the underlying condition is
     * re-evaluated server-side by the rules engine and surfaces through Needs-attention, which is
     * where "is this still a problem?" is answered.
     *
     * Applied optimistically so the row updates under the user's finger while the destination is
     * opening, then reverted if the write fails -- showing something as read when the server still
     * has it unread would be a small lie that survives the next refresh.
     */
    fun markRead(id: String) {
        val current = _uiState.value as? NotificationsUiState.Loaded ?: return
        val target = current.notifications.firstOrNull { it.id == id } ?: return
        if (target.readAt != null) return

        val optimisticAt = Instant.now().toString()
        _uiState.value = NotificationsUiState.Loaded(
            current.notifications.map { if (it.id == id) it.copy(readAt = optimisticAt) else it },
        )

        viewModelScope.launch {
            if (repository.markRead(id) is MarkReadResult.Error) {
                val now = _uiState.value as? NotificationsUiState.Loaded ?: return@launch
                // Revert only this row, and only if nothing else has changed it since.
                _uiState.value = NotificationsUiState.Loaded(
                    now.notifications.map {
                        if (it.id == id && it.readAt == optimisticAt) it.copy(readAt = null) else it
                    },
                )
            }
        }
    }
}
