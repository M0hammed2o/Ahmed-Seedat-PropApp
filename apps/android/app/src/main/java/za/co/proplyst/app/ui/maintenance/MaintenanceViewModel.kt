package za.co.proplyst.app.ui.maintenance

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.data.documents.DocumentUrlResult
import za.co.proplyst.app.data.documents.TenantDocument
import za.co.proplyst.app.data.maintenance.AttachmentUploadResult
import za.co.proplyst.app.data.maintenance.AttachmentsResult
import za.co.proplyst.app.data.maintenance.MaintenanceRepository
import za.co.proplyst.app.data.maintenance.MaintenanceResult
import za.co.proplyst.app.data.maintenance.MaintenanceTicket
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date
import javax.inject.Inject

sealed interface MaintenanceListUiState {
    data object Loading : MaintenanceListUiState
    data class Empty(val message: String) : MaintenanceListUiState
    data class Loaded(val tickets: List<MaintenanceTicket>, val cachedAt: String? = null) : MaintenanceListUiState
    data class Error(val message: String) : MaintenanceListUiState
}

@HiltViewModel
class MaintenanceListViewModel @Inject constructor(
    private val repository: MaintenanceRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<MaintenanceListUiState>(MaintenanceListUiState.Loading)
    val uiState: StateFlow<MaintenanceListUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = MaintenanceListUiState.Loading
            _uiState.value = when (val result = repository.getTickets()) {
                is MaintenanceResult.Live -> {
                    if (result.tickets.isEmpty()) {
                        MaintenanceListUiState.Empty("No maintenance tickets yet")
                    } else {
                        MaintenanceListUiState.Loaded(result.tickets)
                    }
                }
                is MaintenanceResult.Cached -> {
                    val formatted = DateFormat.getDateTimeInstance().format(Date(result.fetchedAtEpochMillis))
                    MaintenanceListUiState.Loaded(result.tickets, cachedAt = formatted)
                }
                is MaintenanceResult.Error -> MaintenanceListUiState.Error(result.message)
            }
        }
    }
}

sealed interface MaintenanceDetailUiState {
    data object Loading : MaintenanceDetailUiState
    data class Loaded(val ticket: MaintenanceTicket) : MaintenanceDetailUiState
    data object NotFound : MaintenanceDetailUiState
}

sealed interface AttachmentsUiState {
    data object Loading : AttachmentsUiState
    data class Loaded(val attachments: List<TenantDocument>) : AttachmentsUiState
    data class Error(val message: String) : AttachmentsUiState
}

/** Android V1 last local blocker pass (WORKLOG.md this date): attachments load independently of
 * the ticket itself (own StateFlow, own retry) so a slow/failed attachment fetch never blocks the
 * ticket details from rendering -- matches this app's own "don't couple unrelated loading states"
 * convention (e.g. PaymentReviewViewModel's separate documentUrl/actionError flows). */
@HiltViewModel
class MaintenanceDetailViewModel @Inject constructor(
    private val repository: MaintenanceRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val ticketId: String = checkNotNull(savedStateHandle["ticketId"])

    private val _uiState = MutableStateFlow<MaintenanceDetailUiState>(MaintenanceDetailUiState.Loading)
    val uiState: StateFlow<MaintenanceDetailUiState> = _uiState.asStateFlow()

    private val _attachmentsState = MutableStateFlow<AttachmentsUiState>(AttachmentsUiState.Loading)
    val attachmentsState: StateFlow<AttachmentsUiState> = _attachmentsState.asStateFlow()

    private val _uploading = MutableStateFlow(false)
    val uploading: StateFlow<Boolean> = _uploading.asStateFlow()

    private val _uploadError = MutableStateFlow<String?>(null)
    val uploadError: StateFlow<String?> = _uploadError.asStateFlow()

    private val _attachmentUrl = MutableStateFlow<String?>(null)
    val attachmentUrl: StateFlow<String?> = _attachmentUrl.asStateFlow()

    init {
        viewModelScope.launch {
            val ticket = repository.getTicketById(ticketId)
            _uiState.value = if (ticket != null) {
                MaintenanceDetailUiState.Loaded(ticket)
            } else {
                MaintenanceDetailUiState.NotFound
            }
        }
        loadAttachments()
    }

    fun loadAttachments() {
        viewModelScope.launch {
            _attachmentsState.value = AttachmentsUiState.Loading
            _attachmentsState.value = when (val result = repository.getAttachments(ticketId)) {
                is AttachmentsResult.Loaded -> AttachmentsUiState.Loaded(result.documents)
                is AttachmentsResult.Error -> AttachmentsUiState.Error(result.message)
            }
        }
    }

    fun uploadAttachment(uri: Uri) {
        _uploadError.value = null
        _uploading.value = true
        viewModelScope.launch {
            when (val result = repository.uploadAttachment(ticketId, uri)) {
                is AttachmentUploadResult.Success -> loadAttachments()
                is AttachmentUploadResult.Error -> _uploadError.value = result.message
            }
            _uploading.value = false
        }
    }

    fun openAttachment(documentId: String) {
        _uploadError.value = null
        viewModelScope.launch {
            when (val result = repository.getAttachmentUrl(documentId)) {
                is DocumentUrlResult.Success -> _attachmentUrl.value = result.signedUrl
                is DocumentUrlResult.Error -> _uploadError.value = result.message
            }
        }
    }

    fun consumeAttachmentUrl() {
        _attachmentUrl.value = null
    }
}
