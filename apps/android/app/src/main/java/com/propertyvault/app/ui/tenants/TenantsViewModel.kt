package com.propertyvault.app.ui.tenants

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.propertyvault.app.data.tenants.Tenant
import com.propertyvault.app.data.tenants.TenantsRepository
import com.propertyvault.app.data.tenants.TenantsResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date
import javax.inject.Inject

sealed interface TenantsListUiState {
    data object Loading : TenantsListUiState
    data class Empty(val message: String) : TenantsListUiState
    data class Loaded(val tenants: List<Tenant>, val cachedAt: String? = null) : TenantsListUiState
    data class Error(val message: String) : TenantsListUiState
}

@HiltViewModel
class TenantsListViewModel @Inject constructor(
    private val repository: TenantsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<TenantsListUiState>(TenantsListUiState.Loading)
    val uiState: StateFlow<TenantsListUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = TenantsListUiState.Loading
            _uiState.value = when (val result = repository.getTenants()) {
                is TenantsResult.Live -> {
                    if (result.tenants.isEmpty()) {
                        TenantsListUiState.Empty("No tenants yet")
                    } else {
                        TenantsListUiState.Loaded(result.tenants)
                    }
                }
                is TenantsResult.Cached -> {
                    val formatted = DateFormat.getDateTimeInstance().format(Date(result.fetchedAtEpochMillis))
                    TenantsListUiState.Loaded(result.tenants, cachedAt = formatted)
                }
                is TenantsResult.Error -> TenantsListUiState.Error(result.message)
            }
        }
    }
}

sealed interface TenantDetailUiState {
    data object Loading : TenantDetailUiState
    data class Loaded(val tenant: Tenant) : TenantDetailUiState
    data object NotFound : TenantDetailUiState
}

@HiltViewModel
class TenantDetailViewModel @Inject constructor(
    private val repository: TenantsRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val tenantId: String = checkNotNull(savedStateHandle["tenantId"])

    private val _uiState = MutableStateFlow<TenantDetailUiState>(TenantDetailUiState.Loading)
    val uiState: StateFlow<TenantDetailUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val tenant = repository.getTenantById(tenantId)
            _uiState.value = if (tenant != null) TenantDetailUiState.Loaded(tenant) else TenantDetailUiState.NotFound
        }
    }
}
