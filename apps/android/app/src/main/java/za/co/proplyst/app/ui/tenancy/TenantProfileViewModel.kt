package za.co.proplyst.app.ui.tenancy

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import za.co.proplyst.app.data.tenancy.TenancyLeaseResult
import za.co.proplyst.app.data.tenancy.TenancyRepository
import javax.inject.Inject

@HiltViewModel
class TenantProfileViewModel @Inject constructor(
    private val tenancyRepository: TenancyRepository,
) : ViewModel() {

    private val _leaseUiState = MutableStateFlow<TenancyLeaseResult>(TenancyLeaseResult.NoTenancy)
    val leaseUiState: StateFlow<TenancyLeaseResult> = _leaseUiState.asStateFlow()

    init {
        viewModelScope.launch {
            _leaseUiState.value = tenancyRepository.getMyLease()
        }
    }
}
