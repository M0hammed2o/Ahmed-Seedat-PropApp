package za.co.proplyst.app.ui.tenancy

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import za.co.proplyst.app.data.tenancy.TenancyLease
import za.co.proplyst.app.data.tenancy.TenancyLeaseResult
import za.co.proplyst.app.data.tenancy.TenancyRepository
import javax.inject.Inject

sealed interface MyLeaseUiState {
    data object Loading : MyLeaseUiState
    data class Loaded(val lease: TenancyLease) : MyLeaseUiState
    data object NoTenancy : MyLeaseUiState
    data class Error(val message: String) : MyLeaseUiState
}

@HiltViewModel
class MyLeaseViewModel @Inject constructor(
    private val repository: TenancyRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow<MyLeaseUiState>(MyLeaseUiState.Loading)
    val uiState: StateFlow<MyLeaseUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = MyLeaseUiState.Loading
            _uiState.value = when (val result = repository.getMyLease()) {
                is TenancyLeaseResult.Loaded -> MyLeaseUiState.Loaded(result.lease)
                is TenancyLeaseResult.NoTenancy -> MyLeaseUiState.NoTenancy
                is TenancyLeaseResult.Error -> MyLeaseUiState.Error(result.message)
            }
        }
    }
}
