package za.co.proplyst.app.ui.dashboard

import app.cash.turbine.test
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
import org.junit.Before
import org.junit.Test
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.AuthState
import za.co.proplyst.app.data.auth.OrgMembership
import za.co.proplyst.app.data.auth.TenancyMembership

/**
 * V1 billing invoice pass (WORKLOG.md this date), Phase 12/14: DashboardViewModel.isPrincipal
 * gates the "Manage subscription" entry point -- only an org principal should ever see it. These
 * assert the exact role/status combinations that must and must not grant it.
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

    @Test
    fun `isPrincipal is true when the signed-in user has a principal org membership`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = "org-1", role = "principal", status = "active")),
            ),
        )
        val viewModel = DashboardViewModel(authRepository)

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
        val viewModel = DashboardViewModel(authRepository)

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
        val viewModel = DashboardViewModel(authRepository)

        viewModel.isPrincipal.test {
            assertEquals(false, awaitItem())
        }
    }

    @Test
    fun `isPrincipal is false while unauthenticated or loading`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(AuthState.Unauthenticated)
        val viewModel = DashboardViewModel(authRepository)

        viewModel.isPrincipal.test {
            assertEquals(false, awaitItem())
        }
    }
}
