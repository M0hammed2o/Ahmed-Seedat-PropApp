package za.co.proplyst.app.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.AuthState
import za.co.proplyst.app.data.insights.PortfolioInsight
import za.co.proplyst.app.data.insights.PortfolioInsightsRepository
import za.co.proplyst.app.data.insights.PortfolioInsightsResult
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
 *
 * Final pre-UAT engineering pass (WORKLOG.md this date), Part 5: also loads the Portfolio
 * Intelligence feed (the same deterministic rules-engine data the web dashboard's
 * PortfolioInsightsPanel.tsx shows, AI_ARCHITECTURE.md §2 -- never an LLM), replacing this
 * screen's own "not yet built" placeholder. `orgId` is the caller's own first OrgMembership --
 * there is no multi-org switcher anywhere in this app yet (confirmed before writing this), so this
 * establishes the same "first org" convention `isPrincipal` above already uses implicitly.
 */
@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val insightsRepository: PortfolioInsightsRepository,
) : ViewModel() {
    val isPrincipal: StateFlow<Boolean> = authRepository.authState
        .map { state ->
            (state as? AuthState.Authenticated)?.organizations?.any { it.role == "principal" } ?: false
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    private val _insightsUiState = MutableStateFlow<InsightsUiState>(InsightsUiState.Loading)
    val insightsUiState: StateFlow<InsightsUiState> = _insightsUiState.asStateFlow()

    init {
        loadInsights()
    }

    fun loadInsights() {
        viewModelScope.launch {
            _insightsUiState.value = InsightsUiState.Loading
            // A synchronous StateFlow.value read, not a suspending wait for a future
            // Authenticated emission -- DashboardScreen only ever renders once auth has already
            // resolved (behind OwnerRootScreen's own gate), so the current value is always
            // already correct by construction; awaiting a future emission that may never arrive
            // (e.g. an unauthenticated/loading state that never transitions) would otherwise leave
            // this coroutine suspended forever.
            val orgId = (authRepository.authState.value as? AuthState.Authenticated)
                ?.organizations
                ?.firstOrNull()
                ?.orgId
            if (orgId == null) {
                _insightsUiState.value = InsightsUiState.Empty
                return@launch
            }
            _insightsUiState.value = when (val result = insightsRepository.getPortfolioInsights(orgId)) {
                is PortfolioInsightsResult.Loaded ->
                    if (result.insights.isEmpty()) InsightsUiState.Empty
                    else InsightsUiState.Loaded(result.insights)
                is PortfolioInsightsResult.Error -> InsightsUiState.Error(result.message)
            }
        }
    }
}

sealed interface InsightsUiState {
    data object Loading : InsightsUiState
    data object Empty : InsightsUiState
    data class Loaded(val insights: List<PortfolioInsight>) : InsightsUiState
    data class Error(val message: String) : InsightsUiState
}
