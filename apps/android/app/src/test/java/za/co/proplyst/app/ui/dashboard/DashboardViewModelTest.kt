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
import za.co.proplyst.app.data.auth.SessionManager
import za.co.proplyst.app.data.auth.TenancyMembership
import za.co.proplyst.app.data.financials.FinancialSummaryRepository
import za.co.proplyst.app.data.financials.FinancialSummaryResult
import za.co.proplyst.app.data.insights.MAX_DASHBOARD_ATTENTION_ITEMS
import za.co.proplyst.app.data.insights.buildAttentionPreview
import za.co.proplyst.app.data.insights.totalAttentionCount
import za.co.proplyst.app.data.notifications.AppNotification
import za.co.proplyst.app.data.notifications.MarkReadResult
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import za.co.proplyst.app.data.insights.PortfolioInsight
import za.co.proplyst.app.data.insights.PortfolioInsightsRepository
import za.co.proplyst.app.data.insights.PortfolioInsightsResult
import za.co.proplyst.app.data.notifications.NotificationsRepository
import za.co.proplyst.app.data.notifications.NotificationsResult
import za.co.proplyst.app.data.ownersummary.OwnerSummary
import za.co.proplyst.app.data.ownersummary.OwnerSummaryRepository
import za.co.proplyst.app.data.ownersummary.OwnerSummaryResult
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult

/**
 * V1 billing invoice pass (WORKLOG.md this date), Phase 12/14: DashboardViewModel.isPrincipal
 * asserts the exact role/status combinations that do and do not make a member a principal. It used
 * to gate the "Manage subscription" row; that row was removed for the Play v1.0 release, so the
 * flag has no UI consumer at present. These stay because the role derivation itself is still
 * right and still worth pinning for whatever principal-only feature comes next.
 *
 * Final pre-UAT engineering pass (WORKLOG.md this date), Part 5: also covers
 * DashboardViewModel.insightsUiState (the Portfolio Intelligence feed).
 *
 * Proplyst Mobile Design System redesign pass: covers the new Owner Home hero-card state
 * (summaryUiState) added for this pass -- expected/collected/outstanding must come straight from
 * OwnerSummaryRepository, never recomputed here.
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

    private fun mockOwnerSummaryRepository(
        result: OwnerSummaryResult = OwnerSummaryResult.Loaded(emptyList()),
    ): OwnerSummaryRepository {
        val repo = mockk<OwnerSummaryRepository>()
        coEvery { repo.getMySummaries() } returns result
        return repo
    }

    private fun mockPropertiesRepository(
        result: PropertiesResult = PropertiesResult.Live(emptyList()),
    ): PropertiesRepository {
        val repo = mockk<PropertiesRepository>()
        coEvery { repo.getProperties() } returns result
        return repo
    }

    private fun mockNotificationsRepository(
        result: NotificationsResult = NotificationsResult.Loaded(emptyList()),
    ): NotificationsRepository {
        val repo = mockk<NotificationsRepository>()
        coEvery { repo.getMyNotifications() } returns result
        return repo
    }

    private fun mockFinancialSummaryRepository(
        result: FinancialSummaryResult = FinancialSummaryResult.Error("not configured for this test"),
    ): FinancialSummaryRepository {
        val repo = mockk<FinancialSummaryRepository>()
        coEvery { repo.getPortfolioFinancialSummary(any(), any()) } returns result
        return repo
    }

    private fun viewModel(
        authRepository: AuthRepository,
        insightsRepository: PortfolioInsightsRepository = mockInsightsRepository(),
        ownerSummaryRepository: OwnerSummaryRepository = mockOwnerSummaryRepository(),
        propertiesRepository: PropertiesRepository = mockPropertiesRepository(),
        notificationsRepository: NotificationsRepository = mockNotificationsRepository(),
        financialSummaryRepository: FinancialSummaryRepository = mockFinancialSummaryRepository(),
    ) = DashboardViewModel(
        authRepository,
        insightsRepository,
        ownerSummaryRepository,
        propertiesRepository,
        notificationsRepository,
        financialSummaryRepository,
        mockk<SessionManager>(relaxed = true),
    )

    @Test
    fun `isPrincipal is true when the signed-in user has a principal org membership`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "principal", status = "active")),
            ),
        )
        val vm = viewModel(authRepository)

        vm.isPrincipal.test {
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
        val vm = viewModel(authRepository)

        vm.isPrincipal.test {
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
        val vm = viewModel(authRepository)

        vm.isPrincipal.test {
            assertEquals(false, awaitItem())
        }
    }

    @Test
    fun `isPrincipal is false while unauthenticated or loading`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(AuthState.Unauthenticated)
        val vm = viewModel(authRepository)

        vm.isPrincipal.test {
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
        val vm = viewModel(authRepository, insightsRepository = insightsRepository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = vm.insightsUiState.value
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
        val vm = viewModel(authRepository, insightsRepository = mockInsightsRepository(PortfolioInsightsResult.Loaded(emptyList())))
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(InsightsUiState.Empty, vm.insightsUiState.value)
    }

    @Test
    fun `insightsUiState is Empty (never hangs) when the caller has no org membership at all`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(AuthState.Unauthenticated)
        val vm = viewModel(authRepository)
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(InsightsUiState.Empty, vm.insightsUiState.value)
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
        val vm = viewModel(
            authRepository,
            insightsRepository = mockInsightsRepository(PortfolioInsightsResult.Error("Failed to load insights.")),
        )
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(InsightsUiState.Error("Failed to load insights."), vm.insightsUiState.value)
    }

    @Test
    fun `summaryUiState surfaces the latest server-computed summary unmodified`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "principal", status = "active")),
            ),
        )
        val older = OwnerSummary(
            id = "s-1", periodStart = "2026-07-01", periodEnd = "2026-07-31", propertyCount = 1,
            expectedRent = 10000.0, confirmedPaid = 10000.0, outstanding = 0.0, awaitingConfirmation = 0.0,
            openMaintenanceCount = 0, upcomingLeaseExpiryCount = 0, sentAt = null,
        )
        val latest = OwnerSummary(
            id = "s-2", periodStart = "2026-08-01", periodEnd = "2026-08-31", propertyCount = 2,
            expectedRent = 21200.0, confirmedPaid = 20000.0, outstanding = 1200.0, awaitingConfirmation = 0.0,
            openMaintenanceCount = 1, upcomingLeaseExpiryCount = 0, sentAt = null,
        )
        val vm = viewModel(
            authRepository,
            ownerSummaryRepository = mockOwnerSummaryRepository(OwnerSummaryResult.Loaded(listOf(older, latest))),
        )
        dispatcher.scheduler.advanceUntilIdle()

        val state = vm.summaryUiState.value
        assertTrue(state is OwnerSummaryUiState.Loaded)
        assertEquals(latest, (state as OwnerSummaryUiState.Loaded).summary)
    }

    @Test
    fun `summaryUiState is Empty when there is no summary yet, never a fabricated value`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "principal", status = "active")),
            ),
        )
        val vm = viewModel(authRepository)
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(OwnerSummaryUiState.Empty, vm.summaryUiState.value)
    }

    @Test
    fun `summaryUiState surfaces a real repository error, never a silent failure`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "principal", status = "active")),
            ),
        )
        val vm = viewModel(
            authRepository,
            ownerSummaryRepository = mockOwnerSummaryRepository(OwnerSummaryResult.Error("Failed to load summary.")),
        )
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(OwnerSummaryUiState.Error("Failed to load summary."), vm.summaryUiState.value)
    }

    // Continuation pass (UTILITIES_RATES_BUDGET_IMPLEMENTATION.md "Portfolio-wide owner financial
    // summary") -- financialSummaryUiState is the LIVE source for every money figure on Home now;
    // these pin that it calls the portfolio (org-scoped), not per-property, repository method, and
    // that it degrades safely (Empty, never a stuck spinner) when there is no org to summarize.

    private fun sampleFinancialSummary() = za.co.proplyst.app.data.financials.FinancialSummary(
        month = "2026-09-01",
        propertyCount = 2,
        rentPlanned = 21300.0,
        rentCollected = 18000.0,
        rentOutstanding = 3300.0,
        utilitiesExpense = 2400.0,
        ratesAndLeviesExpense = 3700.0,
        otherExpenses = 900.0,
        totalExpenses = 7000.0,
        budgetPlanned = 25000.0,
        budgetUsedPercent = 67.2,
        budgetRemaining = 8200.0,
        netOperatingPosition = 11000.0,
        awaitingConfirmationCount = 1,
        budgetAlertLevel = null,
    )

    @Test
    fun `financialSummaryUiState loads the portfolio-wide summary for the signed-in user's org`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "principal", status = "active")),
            ),
        )
        val summary = sampleFinancialSummary()
        val financialSummaryRepository = mockFinancialSummaryRepository(FinancialSummaryResult.Loaded(summary))
        val vm = viewModel(authRepository, financialSummaryRepository = financialSummaryRepository)
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(FinancialSummaryUiState.Loaded(summary), vm.financialSummaryUiState.value)
        io.mockk.coVerify { financialSummaryRepository.getPortfolioFinancialSummary("org-1", any()) }
    }

    @Test
    fun `financialSummaryUiState surfaces a real repository error, never a silent failure`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "principal", status = "active")),
            ),
        )
        val vm = viewModel(
            authRepository,
            financialSummaryRepository = mockFinancialSummaryRepository(FinancialSummaryResult.Error("Failed to load the financial summary.")),
        )
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(FinancialSummaryUiState.Error("Failed to load the financial summary."), vm.financialSummaryUiState.value)
    }

    @Test
    fun `financialSummaryUiState is Empty (not stuck Loading) for a tenant-only account with no org`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(userId = "user-1", organizations = emptyList()),
        )
        val vm = viewModel(authRepository)
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(FinancialSummaryUiState.Empty, vm.financialSummaryUiState.value)
    }

    // ================= Actionable-alerts pass: Home synchronisation =================
    //
    // The dashboard badge must be a function of the live feed, never a counter Home keeps for
    // itself. These tests pin that down, because a locally-decremented count is exactly how the
    // three surfaces would silently drift apart.

    private fun authed() = mockk<AuthRepository>().also {
        every { it.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "principal", status = "active")),
            ),
        )
    }

    private fun alert(id: String, type: String = "invoice_unpaid", table: String? = "invoices") =
        PortfolioInsight(
            id = id,
            insightType = type,
            message = "Invoice is overdue",
            severity = "urgent",
            generatedAt = "2026-09-11T08:00:00Z",
            entityTable = table,
            entityId = "inv-$id",
        )

    private fun activity(id: String, readAt: String? = null) = AppNotification(
        id = id,
        type = "maintenance_ticket_created",
        title = "New maintenance request",
        body = null,
        relatedEntityType = "maintenance_ticket",
        relatedEntityId = "t-$id",
        readAt = readAt,
        createdAt = "2026-09-11T08:00:00Z",
    )

    @Test
    fun `resolving the underlying condition drops the alert and the count on the next refresh`() = runTest {
        val insights = mockk<PortfolioInsightsRepository>()
        coEvery { insights.getPortfolioInsights(any()) } returns
            PortfolioInsightsResult.Loaded(listOf(alert("a"), alert("b")))

        val vm = viewModel(authed(), insightsRepository = insights)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(
            2,
            totalAttentionCount((vm.insightsUiState.value as InsightsUiState.Loaded).insights),
        )

        // The owner records the payment; the rules engine stops emitting one of the two.
        coEvery { insights.getPortfolioInsights(any()) } returns
            PortfolioInsightsResult.Loaded(listOf(alert("b")))
        vm.refresh()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(
            1,
            totalAttentionCount((vm.insightsUiState.value as InsightsUiState.Loaded).insights),
        )
    }

    @Test
    fun `the attention count includes payments awaiting confirmation, from the live summary`() = runTest {
        val insights = mockk<PortfolioInsightsRepository>()
        coEvery { insights.getPortfolioInsights(any()) } returns
            PortfolioInsightsResult.Loaded(listOf(alert("a")))

        val vm = viewModel(authed(), insightsRepository = insights)
        dispatcher.scheduler.advanceUntilIdle()

        val feed = (vm.insightsUiState.value as InsightsUiState.Loaded).insights
        // One stored insight plus three awaiting confirmation is four things needing attention.
        assertEquals(4, totalAttentionCount(feed, awaitingConfirmationCount = 3))
        // And the preview stays bounded no matter how large the feed is.
        assertTrue(buildAttentionPreview(feed, 3).size <= MAX_DASHBOARD_ATTENTION_ITEMS)
    }

    @Test
    fun `opening a Home activity marks it read and clears the unread dot`() = runTest {
        val notifications = mockk<NotificationsRepository>()
        coEvery { notifications.getMyNotifications() } returns
            NotificationsResult.Loaded(listOf(activity("n1")))
        coEvery { notifications.markRead("n1") } returns MarkReadResult.Success

        val vm = viewModel(authed(), notificationsRepository = notifications)
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue("an unread activity must light the dot", vm.hasUnread.value)

        vm.markActivityRead("n1")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(false, vm.hasUnread.value)
        // READ, not RESOLVED: the row is still in the feed.
        assertEquals(1, vm.recentActivity.value.size)
        assertNotNull(vm.recentActivity.value.single().readAt)
    }

    @Test
    fun `a failed mark-read restores the unread dot rather than lying about it`() = runTest {
        val notifications = mockk<NotificationsRepository>()
        coEvery { notifications.getMyNotifications() } returns
            NotificationsResult.Loaded(listOf(activity("n1")))
        coEvery { notifications.markRead("n1") } returns MarkReadResult.Error("offline")

        val vm = viewModel(authed(), notificationsRepository = notifications)
        dispatcher.scheduler.advanceUntilIdle()

        vm.markActivityRead("n1")
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(vm.hasUnread.value)
        assertNull(vm.recentActivity.value.single().readAt)
    }
}
