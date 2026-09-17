package za.co.proplyst.app.ui.dashboard

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
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
import za.co.proplyst.app.data.financials.FinancialSummaryRepository
import za.co.proplyst.app.data.insights.AlertActionResult
import za.co.proplyst.app.data.insights.PortfolioInsight
import za.co.proplyst.app.data.insights.PortfolioInsightsRepository
import za.co.proplyst.app.data.insights.PortfolioInsightsResult
import za.co.proplyst.app.data.notifications.AppNotification
import za.co.proplyst.app.data.notifications.MarkReadResult
import za.co.proplyst.app.data.notifications.NotificationsRepository
import za.co.proplyst.app.data.notifications.NotificationsResult
import za.co.proplyst.app.data.ownersummary.OwnerSummaryRepository
import za.co.proplyst.app.data.properties.PropertiesRepository

/**
 * Clearing things from the owner's queues (2026-09-17).
 *
 * The rule these pin down: taking an alert or an activity entry off the screen must never change the
 * business fact underneath it. Acknowledging "4 overdue rent invoices" does not pay them;
 * dismissing "Partial rent received" does not delete the payment. Only the server call differs, and
 * neither call touches an invoice or a ticket.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AlertAndActivityDismissalTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun insight(id: String) = PortfolioInsight(
        id = id,
        insightType = "rent_overdue",
        message = "4 overdue rent invoices",
        severity = "critical",
        generatedAt = "2026-09-17T08:00:00Z",
    )

    private fun notification(id: String) = AppNotification(
        id = id,
        type = "payment_partial",
        title = "Partial rent received",
        body = "Bongani Cele paid R6 000 of R10 800.",
        relatedEntityType = "invoice",
        relatedEntityId = "invoice-1",
        readAt = null,
        createdAt = "2026-09-17T08:00:00Z",
    )

    private fun viewModel(
        insights: PortfolioInsightsRepository,
        notifications: NotificationsRepository = mockk(relaxed = true),
    ): DashboardViewModel {
        val auth = mockk<AuthRepository>(relaxed = true)
        every { auth.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "principal", status = "active")),
            ),
        )
        val sessions = mockk<SessionManager>(relaxed = true)
        every { sessions.getEmail() } returns "owner@example.com"
        return DashboardViewModel(
            authRepository = auth,
            insightsRepository = insights,
            ownerSummaryRepository = mockk(relaxed = true),
            propertiesRepository = mockk<PropertiesRepository>(relaxed = true),
            notificationsRepository = notifications,
            financialSummaryRepository = mockk<FinancialSummaryRepository>(relaxed = true),
            sessionManager = sessions,
        )
    }

    @Test
    fun `acknowledging an alert calls acknowledge, never dismiss, and takes it off the feed`() = runTest(dispatcher) {
        val insights = mockk<PortfolioInsightsRepository>(relaxed = true)
        coEvery { insights.getPortfolioInsights(any()) } returns
            PortfolioInsightsResult.Loaded(listOf(insight("alert-1"), insight("alert-2")))
        coEvery { insights.acknowledge("alert-1") } returns AlertActionResult.Success
        val vm = viewModel(insights)
        advanceUntilIdle()

        vm.resolveAlert("alert-1", acknowledge = true)
        advanceUntilIdle()

        coVerify(exactly = 1) { insights.acknowledge("alert-1") }
        coVerify(exactly = 0) { insights.dismiss(any()) }
        val shown = (vm.insightsUiState.value as InsightsUiState.Loaded).insights.map { it.id }
        assertEquals(listOf("alert-2"), shown)
    }

    @Test
    fun `dismissing an alert calls dismiss, never acknowledge`() = runTest(dispatcher) {
        val insights = mockk<PortfolioInsightsRepository>(relaxed = true)
        coEvery { insights.getPortfolioInsights(any()) } returns
            PortfolioInsightsResult.Loaded(listOf(insight("alert-1")))
        coEvery { insights.dismiss("alert-1") } returns AlertActionResult.Success
        val vm = viewModel(insights)
        advanceUntilIdle()

        vm.resolveAlert("alert-1", acknowledge = false)
        advanceUntilIdle()

        coVerify(exactly = 1) { insights.dismiss("alert-1") }
        coVerify(exactly = 0) { insights.acknowledge(any()) }
        assertTrue(vm.insightsUiState.value is InsightsUiState.Empty)
    }

    @Test
    fun `an alert the server refuses to clear comes back, with a message`() = runTest(dispatcher) {
        val insights = mockk<PortfolioInsightsRepository>(relaxed = true)
        coEvery { insights.getPortfolioInsights(any()) } returns
            PortfolioInsightsResult.Loaded(listOf(insight("alert-1"), insight("alert-2")))
        coEvery { insights.dismiss("alert-1") } returns AlertActionResult.Error("Couldn't update this alert.")
        val vm = viewModel(insights)
        advanceUntilIdle()

        vm.resolveAlert("alert-1", acknowledge = false)
        advanceUntilIdle()

        val shown = (vm.insightsUiState.value as InsightsUiState.Loaded).insights.map { it.id }
        assertTrue("the alert must be restored: $shown", shown.contains("alert-1"))
        assertEquals("Couldn't update this alert.", vm.alertActionError.value)
    }

    @Test
    fun `dismissing an activity entry hides it and never asks to delete anything`() = runTest(dispatcher) {
        val notifications = mockk<NotificationsRepository>(relaxed = true)
        coEvery { notifications.getMyNotifications() } returns
            NotificationsResult.Loaded(listOf(notification("activity-1"), notification("activity-2")))
        coEvery { notifications.dismiss("activity-1") } returns MarkReadResult.Success
        val insights = mockk<PortfolioInsightsRepository>(relaxed = true)
        coEvery { insights.getPortfolioInsights(any()) } returns PortfolioInsightsResult.Loaded(emptyList())
        val vm = viewModel(insights, notifications)
        advanceUntilIdle()

        vm.dismissActivity("activity-1")
        advanceUntilIdle()

        coVerify(exactly = 1) { notifications.dismiss("activity-1") }
        // The only other call is the refetch that backfills the feed -- nothing that deletes.
        coVerify(exactly = 0) { notifications.markRead(any()) }
    }

    @Test
    fun `an activity entry the server refuses to hide comes back`() = runTest(dispatcher) {
        val notifications = mockk<NotificationsRepository>(relaxed = true)
        coEvery { notifications.getMyNotifications() } returns
            NotificationsResult.Loaded(listOf(notification("activity-1"), notification("activity-2")))
        coEvery { notifications.dismiss("activity-1") } returns MarkReadResult.Error("offline")
        val insights = mockk<PortfolioInsightsRepository>(relaxed = true)
        coEvery { insights.getPortfolioInsights(any()) } returns PortfolioInsightsResult.Loaded(emptyList())
        val vm = viewModel(insights, notifications)
        advanceUntilIdle()

        vm.dismissActivity("activity-1")
        advanceUntilIdle()

        assertEquals(listOf("activity-1", "activity-2"), vm.recentActivity.value.map { it.id })
        assertTrue(vm.alertActionError.value.orEmpty().contains("dismiss", ignoreCase = true))
    }
}
