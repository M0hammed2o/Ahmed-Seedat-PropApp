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

    /** No per-caller read-status join exists on the list endpoint (see AnnouncementsRepository's
     * doc comment) -- this session-local set is the only record of "acknowledged," and resets on
     * next load(). A real, disclosed limitation, not a bug. */
    private val _acknowledgedIds = MutableStateFlow<Set<String>>(emptySet())
    val acknowledgedIds: StateFlow<Set<String>> = _acknowledgedIds.asStateFlow()

    private val _actionError = MutableStateFlow<String?>(null)
    val actionError: StateFlow<String?> = _actionError.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = AnnouncementsUiState.Loading
            _acknowledgedIds.value = emptySet()
            _uiState.value = when (val result = repository.getMyAnnouncements()) {
                is AnnouncementsResult.Loaded ->
                    if (result.announcements.isEmpty()) AnnouncementsUiState.Empty
                    else AnnouncementsUiState.Loaded(result.announcements)
                is AnnouncementsResult.Error -> AnnouncementsUiState.Error(result.message)
            }
        }
    }

    fun acknowledge(id: String) {
        _actionError.value = null
        _busyId.value = id
        viewModelScope.launch {
            when (val result = repository.acknowledge(id)) {
                is AcknowledgeResult.Success -> _acknowledgedIds.value = _acknowledgedIds.value + id
                is AcknowledgeResult.Error -> _actionError.value = result.message
            }
            _busyId.value = null
        }
    }
}
