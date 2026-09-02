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
import za.co.proplyst.app.data.notifications.AppNotification
import za.co.proplyst.app.data.notifications.NotificationsRepository
import za.co.proplyst.app.data.notifications.NotificationsResult
import za.co.proplyst.app.data.ownersummary.OwnerSummary
import za.co.proplyst.app.data.ownersummary.OwnerSummaryRepository
import za.co.proplyst.app.data.ownersummary.OwnerSummaryResult
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult
import javax.inject.Inject

/**
 * Owner Home (Proplyst Mobile Design System redesign pass -- the approved Navy Deck "most
 * important Owner screen"). Backs DashboardScreen.kt's hero card (collected/billed/outstanding,
 * from [OwnerSummaryRepository] -- the same immutable server-computed monthly snapshot the web
 * app shows, never recalculated here), KPI strip, "Needs attention" (the existing Portfolio
 * Intelligence feed, [PortfolioInsightsRepository], AI_ARCHITECTURE.md §2 -- a deterministic rules
 * engine, never an LLM), "Recent activity" (the existing in-app notification feed,
 * [NotificationsRepository], reused rather than duplicated), and "Top properties" ([PropertiesRepository]).
 *
 * `isPrincipal` predates this pass (V1 billing invoice pass) and still gates the "Manage
 * subscription" entry point, now surfaced from OwnerMoreScreen instead of a Dashboard toolbar icon.
 */
@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val insightsRepository: PortfolioInsightsRepository,
    private val ownerSummaryRepository: OwnerSummaryRepository,
    private val propertiesRepository: PropertiesRepository,
    private val notificationsRepository: NotificationsRepository,
) : ViewModel() {
    val isPrincipal: StateFlow<Boolean> = authRepository.authState
        .map { state ->
            (state as? AuthState.Authenticated)?.organizations?.any { it.role == "principal" } ?: false
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    private val _insightsUiState = MutableStateFlow<InsightsUiState>(InsightsUiState.Loading)
    val insightsUiState: StateFlow<InsightsUiState> = _insightsUiState.asStateFlow()

    private val _summaryUiState = MutableStateFlow<OwnerSummaryUiState>(OwnerSummaryUiState.Loading)
    val summaryUiState: StateFlow<OwnerSummaryUiState> = _summaryUiState.asStateFlow()

    private val _topProperties = MutableStateFlow<List<Property>>(emptyList())
    val topProperties: StateFlow<List<Property>> = _topProperties.asStateFlow()

    private val _recentActivity = MutableStateFlow<List<AppNotification>>(emptyList())
    val recentActivity: StateFlow<List<AppNotification>> = _recentActivity.asStateFlow()

    init {
        loadInsights()
        loadSummary()
        loadTopProperties()
        loadRecentActivity()
    }

    private fun currentOrgId(): String? =
        (authRepository.authState.value as? AuthState.Authenticated)?.organizations?.firstOrNull()?.orgId

    fun loadInsights() {
        viewModelScope.launch {
            _insightsUiState.value = InsightsUiState.Loading
            // A synchronous StateFlow.value read, not a suspending wait for a future
            // Authenticated emission -- DashboardScreen only ever renders once auth has already
            // resolved (behind OwnerRootScreen's own gate), so the current value is always
            // already correct by construction; awaiting a future emission that may never arrive
            // (e.g. an unauthenticated/loading state that never transitions) would otherwise leave
            // this coroutine suspended forever.
            val orgId = currentOrgId()
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

    fun loadSummary() {
        viewModelScope.launch {
            _summaryUiState.value = OwnerSummaryUiState.Loading
            _summaryUiState.value = when (val result = ownerSummaryRepository.getMySummaries()) {
                is OwnerSummaryResult.Loaded -> {
                    // "the" current summary is whichever period ends latest -- the server already
                    // returns these ordered, but this is defensive rather than assuming order.
                    val latest = result.summaries.maxByOrNull { it.periodEnd }
                    if (latest == null) OwnerSummaryUiState.Empty else OwnerSummaryUiState.Loaded(latest)
                }
                is OwnerSummaryResult.Error -> OwnerSummaryUiState.Error(result.message)
            }
        }
    }

    private fun loadTopProperties() {
        viewModelScope.launch {
            _topProperties.value = when (val result = propertiesRepository.getProperties()) {
                is PropertiesResult.Live -> result.properties
                is PropertiesResult.Cached -> result.properties
                is PropertiesResult.Error -> emptyList()
            }.take(6)
        }
    }

    private fun loadRecentActivity() {
        viewModelScope.launch {
            _recentActivity.value = when (val result = notificationsRepository.getMyNotifications()) {
                is NotificationsResult.Loaded -> result.notifications.take(5)
                is NotificationsResult.Error -> emptyList()
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

sealed interface OwnerSummaryUiState {
    data object Loading : OwnerSummaryUiState
    data object Empty : OwnerSummaryUiState
    data class Loaded(val summary: OwnerSummary) : OwnerSummaryUiState
    data class Error(val message: String) : OwnerSummaryUiState
}
