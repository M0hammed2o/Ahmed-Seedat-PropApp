package za.co.proplyst.app.ui.documents

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.data.documents.DocumentUrlResult
import za.co.proplyst.app.data.documents.TenantDocument
import za.co.proplyst.app.data.documents.TenantDocumentsRepository
import za.co.proplyst.app.data.documents.TenantDocumentsResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface DocumentsUiState {
    data object Loading : DocumentsUiState
    data object Empty : DocumentsUiState
    data class Loaded(val documents: List<TenantDocument>) : DocumentsUiState
    data class Error(val message: String) : DocumentsUiState
}

@HiltViewModel
class DocumentsViewModel @Inject constructor(
    private val repository: TenantDocumentsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<DocumentsUiState>(DocumentsUiState.Loading)
    val uiState: StateFlow<DocumentsUiState> = _uiState.asStateFlow()

    private val _openError = MutableStateFlow<String?>(null)
    val openError: StateFlow<String?> = _openError.asStateFlow()

    private val _documentUrl = MutableStateFlow<String?>(null)
    val documentUrl: StateFlow<String?> = _documentUrl.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = DocumentsUiState.Loading
            _uiState.value = when (val result = repository.getMyDocuments()) {
                is TenantDocumentsResult.Loaded ->
                    if (result.documents.isEmpty()) DocumentsUiState.Empty
                    else DocumentsUiState.Loaded(result.documents)
                is TenantDocumentsResult.Error -> DocumentsUiState.Error(result.message)
            }
        }
    }

    fun openDocument(documentId: String) {
        _openError.value = null
        viewModelScope.launch {
            when (val result = repository.getDocumentUrl(documentId)) {
                is DocumentUrlResult.Success -> _documentUrl.value = result.signedUrl
                is DocumentUrlResult.Error -> _openError.value = result.message
            }
        }
    }

    fun consumeDocumentUrl() {
        _documentUrl.value = null
    }
}
