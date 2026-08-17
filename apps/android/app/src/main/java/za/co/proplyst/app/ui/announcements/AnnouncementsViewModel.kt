package za.co.proplyst.app.ui.announcements

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.data.announcements.AcknowledgeResult
import za.co.proplyst.app.data.announcements.Announcement
import za.co.proplyst.app.data.announcements.AnnouncementsRepository
import za.co.proplyst.app.data.announcements.AnnouncementsResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface AnnouncementsUiState {
    data object Loading : AnnouncementsUiState
    data object Empty : AnnouncementsUiState
    data class Loaded(val announcements: List<Announcement>) : AnnouncementsUiState
    data class Error(val message: String) : AnnouncementsUiState
}

@HiltViewModel
class AnnouncementsViewModel @Inject constructor(
    private val repository: AnnouncementsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<AnnouncementsUiState>(AnnouncementsUiState.Loading)
    val uiState: StateFlow<AnnouncementsUiState> = _uiState.asStateFlow()

    private val _busyId = MutableStateFlow<String?>(null)
    val busyId: StateFlow<String?> = _busyId.asStateFlow()

    private val _actionError = MutableStateFlow<String?>(null)
    val actionError: StateFlow<String?> = _actionError.asStateFlow()

    /** Marked true once a not-yet-read, non-required announcement has been silently
     * mark-as-read this screen visit -- prevents re-firing the network call on every
     * recomposition (Android V1 last local blocker pass, WORKLOG.md this date). */
    private val autoMarkedThisLoad = mutableSetOf<String>()

    init {
        load()
    }

    fun load() {
        autoMarkedThisLoad.clear()
        viewModelScope.launch {
            _uiState.value = AnnouncementsUiState.Loading
            _uiState.value = when (val result = repository.getMyAnnouncements()) {
                is AnnouncementsResult.Loaded ->
                    if (result.announcements.isEmpty()) AnnouncementsUiState.Empty
                    else AnnouncementsUiState.Loaded(result.announcements)
                is AnnouncementsResult.Error -> AnnouncementsUiState.Error(result.message)
            }
        }
    }

    /** Explicit "Acknowledge" action, for announcements that require it -- reloads afterwards so
     * the real persisted readAt/acknowledgedAt (from announcement_reads) replaces the stale
     * in-memory copy, rather than guessing the new state client-side. */
    fun acknowledge(id: String) {
        _actionError.value = null
        _busyId.value = id
        viewModelScope.launch {
            when (val result = repository.acknowledge(id)) {
                is AcknowledgeResult.Success -> load()
                is AcknowledgeResult.Error -> _actionError.value = result.message
            }
            _busyId.value = null
        }
    }

    /** Silent read-receipt for an announcement that does NOT require acknowledgement -- same
     * backend call as acknowledge() (there is only one), just triggered by viewing rather than a
     * visible button, and without surfacing an error banner for a best-effort background action
     * the tenant never explicitly asked for. Safe to call repeatedly: no-ops once already marked
     * this load, and the backend upsert is itself idempotent either way. */
    fun markReadIfUnread(announcement: Announcement) {
        if (announcement.requiresAcknowledgement) return
        if (announcement.readAt != null) return
        if (!autoMarkedThisLoad.add(announcement.id)) return
        viewModelScope.launch {
            repository.acknowledge(announcement.id)
        }
    }
}
