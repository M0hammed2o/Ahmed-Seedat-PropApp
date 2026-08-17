package za.co.proplyst.app.navigation

import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.AuthState
import io.mockk.coEvery
import io.mockk.coVerify
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
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RootAuthViewModelTest {

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
    fun `consumePendingDeepLink delegates to the store and clears it`() {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(AuthState.Loading)
        val store = PendingDeepLinkStore()
        store.set(AppLinkDestination.TenantScreen(Destinations.PAYMENTS_LIST))

        val viewModel = RootAuthViewModel(authRepository, store)

        assertEquals(AppLinkDestination.TenantScreen(Destinations.PAYMENTS_LIST), viewModel.consumePendingDeepLink())
        assertNull(viewModel.consumePendingDeepLink())
    }

    @Test
    fun `restoreSession calls through to the repository`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(AuthState.Loading)
        coEvery { authRepository.restoreSession() } returns Unit
        val viewModel = RootAuthViewModel(authRepository, PendingDeepLinkStore())

        viewModel.restoreSession()
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { authRepository.restoreSession() }
    }

    @Test
    fun `signOut calls through to the repository`() = runTest {
        val authRepository = mockk<AuthRepository>()
        every { authRepository.authState } returns MutableStateFlow(AuthState.Loading)
        coEvery { authRepository.signOut() } returns Unit
        val viewModel = RootAuthViewModel(authRepository, PendingDeepLinkStore())

        viewModel.signOut()
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { authRepository.signOut() }
    }
}
