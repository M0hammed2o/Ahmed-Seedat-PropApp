package za.co.proplyst.app.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.AuthState
import javax.inject.Inject

/**
 * V1 billing invoice pass (WORKLOG.md this date), Phase 12: backs DashboardScreen's "Manage
 * subscription" entry point. `isPrincipal` mirrors the web app's own billing-page gate exactly
 * (apps/admin/app/(dashboard)/organization/billing/page.tsx: `activeOrg.role !== 'principal'` ->
 * PermissionDenied) -- true iff the signed-in user holds role "principal" in at least one org
 * membership. DashboardScreen only ever renders inside OwnerRootScreen (never TenantRootScreen,
 * see RootNavGraph.kt's destinationForRole()), so a tenant user never reaches this composable at
 * all; this ViewModel narrows further, within the owner portal, to principal-only -- viewer/
 * accountant/manager members of an org should not see SaaS subscription-management controls
 * either, same as the web app.
 */
@HiltViewModel
class DashboardViewModel @Inject constructor(
    authRepository: AuthRepository,
) : ViewModel() {
    val isPrincipal: StateFlow<Boolean> = authRepository.authState
        .map { state ->
            (state as? AuthState.Authenticated)?.organizations?.any { it.role == "principal" } ?: false
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)
}
