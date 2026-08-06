package com.propertyvault.app.ui.maintenance

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.propertyvault.app.data.maintenance.MaintenanceRepository
import com.propertyvault.app.data.maintenance.MaintenanceResult
import com.propertyvault.app.data.maintenance.MaintenanceTicket
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

@HiltViewModel
class MaintenanceDetailViewModel @Inject constructor(
    private val repository: MaintenanceRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val ticketId: String = checkNotNull(savedStateHandle["ticketId"])

    private val _uiState = MutableStateFlow<MaintenanceDetailUiState>(MaintenanceDetailUiState.Loading)
    val uiState: StateFlow<MaintenanceDetailUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val ticket = repository.getTicketById(ticketId)
            _uiState.value = if (ticket != null) {
                MaintenanceDetailUiState.Loaded(ticket)
            } else {
                MaintenanceDetailUiState.NotFound
            }
        }
    }
}
