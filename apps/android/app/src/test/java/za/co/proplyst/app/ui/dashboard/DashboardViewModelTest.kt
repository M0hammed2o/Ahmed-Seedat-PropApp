package za.co.proplyst.app.ui.dashboard

import app.cash.turbine.test
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.AuthState
import za.co.proplyst.app.data.auth.OrgMembership
import za.co.proplyst.app.data.auth.TenancyMembership
import za.co.proplyst.app.data.insights.PortfolioInsight
import za.co.proplyst.app.data.insights.PortfolioInsightsRepository
import za.co.proplyst.app.data.insights.PortfolioInsightsResult

/**
 * V1 billing invoice pass (WORKLOG.md this date), Phase 12/14: DashboardViewModel.isPrincipal
 * gates the "Manage subscription" entry point -- only an org principal should ever see it. These
 * assert the exact role/status combinations that must and must not grant it.
 *
 * Final pre-UAT engineering pass (WORKLOG.md this date), Part 5: also covers
 * DashboardViewModel.insightsUiState (the Portfolio Intelligence feed).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DashboardViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun mockInsightsRepository(
        result: PortfolioInsightsResult = PortfolioInsightsResult.Loaded(emptyList()),
    ): PortfolioInsightsRepository {
        val repo = mockk<PortfolioInsightsRepository>()
        coEvery { repo.getPortfolioInsights(any()) } returns result
        return repo
    }

    @Test
    fun `isPrincipal is true when the signed-in user has a principal org membership`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "principal", status = "active")),
            ),
        )
        val viewModel = DashboardViewModel(authRepository, mockInsightsRepository())

        viewModel.isPrincipal.test {
            // stateIn's WhileSubscribed collector only starts on this first subscription, so the
            // seed value (false) arrives first, then the real mapped value once it's had a chance
            // to run -- unlike the false-case tests below, where seed and mapped value are equal
            // and StateFlow's own conflation means only one item is ever emitted.
            assertEquals(false, awaitItem())
            assertEquals(true, awaitItem())
        }
    }

    @Test
    fun `isPrincipal is false for a non-principal org role (manager)`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "manager", status = "active")),
            ),
        )
        val viewModel = DashboardViewModel(authRepository, mockInsightsRepository())

        viewModel.isPrincipal.test {
            assertEquals(false, awaitItem())
        }
    }

    @Test
    fun `isPrincipal is false for a tenant-only account (no org memberships at all)`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = emptyList(),
                tenancies = listOf(TenancyMembership(tenantId = "tenant-1", orgId = "org-1", status = "active")),
            ),
        )
        val viewModel = DashboardViewModel(authRepository, mockInsightsRepository())

        viewModel.isPrincipal.test {
            assertEquals(false, awaitItem())
        }
    }

    @Test
    fun `isPrincipal is false while unauthenticated or loading`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(AuthState.Unauthenticated)
        val viewModel = DashboardViewModel(authRepository, mockInsightsRepository())

        viewModel.isPrincipal.test {
            assertEquals(false, awaitItem())
        }
    }

    @Test
    fun `insightsUiState loads real insights for the caller's first org`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "manager", status = "active")),
            ),
        )
        val insight = PortfolioInsight(
            id = "insight-1",
            insightType = "rent_overdue",
            message = "Rent of 1000 is 5 days overdue (due 2026-08-13).",
            severity = "warning",
            generatedAt = "2026-08-18T00:00:00Z",
        )
        val insightsRepository = mockInsightsRepository(PortfolioInsightsResult.Loaded(listOf(insight)))
        val viewModel = DashboardViewModel(authRepository, insightsRepository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.insightsUiState.value
        assertTrue(state is InsightsUiState.Loaded)
        assertEquals(listOf(insight), (state as InsightsUiState.Loaded).insights)
    }

    @Test
    fun `insightsUiState is Empty when the feed has no insights, never a fabricated value`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "manager", status = "active")),
            ),
        )
        val viewModel = DashboardViewModel(authRepository, mockInsightsRepository(PortfolioInsightsResult.Loaded(emptyList())))
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(InsightsUiState.Empty, viewModel.insightsUiState.value)
    }

    @Test
    fun `insightsUiState is Empty (never hangs) when the caller has no org membership at all`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(AuthState.Unauthenticated)
        val viewModel = DashboardViewModel(authRepository, mockInsightsRepository())
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(InsightsUiState.Empty, viewModel.insightsUiState.value)
    }

    @Test
    fun `insightsUiState surfaces a real repository error, never a silent failure`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "manager", status = "active")),
            ),
        )
        val viewModel = DashboardViewModel(
            authRepository,
            mockInsightsRepository(PortfolioInsightsResult.Error("Failed to load insights.")),
        )
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(InsightsUiState.Error("Failed to load insights."), viewModel.insightsUiState.value)
    }
}
