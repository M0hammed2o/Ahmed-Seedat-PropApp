package za.co.proplyst.app.ui.notificationprefs

import za.co.proplyst.app.data.notificationprefs.NotificationCategory
import za.co.proplyst.app.data.notificationprefs.NotificationPreference
import za.co.proplyst.app.data.notificationprefs.NotificationPreferencesRepository
import za.co.proplyst.app.data.notificationprefs.NotificationPreferencesResult
import za.co.proplyst.app.data.notificationprefs.UpdatePreferenceResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NotificationPreferencesViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val samplePreference = NotificationPreference(
        category = NotificationCategory.MAINTENANCE,
        emailEnabled = true,
        pushEnabled = true,
        whatsappEnabled = true,
    )

    @Test
    fun `emits Loaded when the repository returns preferences`() = runTest {
        val repository = mockk<NotificationPreferencesRepository>()
        coEvery { repository.getMyPreferences() } returns NotificationPreferencesResult.Loaded(listOf(samplePreference))

        val viewModel = NotificationPreferencesViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is NotificationPreferencesUiState.Loaded)
        assertEquals(listOf(samplePreference), (state as NotificationPreferencesUiState.Loaded).preferences)
    }

    @Test
    fun `emits Error when the repository fails`() = runTest {
        val repository = mockk<NotificationPreferencesRepository>()
        coEvery { repository.getMyPreferences() } returns NotificationPreferencesResult.Error("network error")

        val viewModel = NotificationPreferencesViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is NotificationPreferencesUiState.Error)
        assertEquals("network error", (state as NotificationPreferencesUiState.Error).message)
    }

    @Test
    fun `toggle flips only the requested channel and reloads on success`() = runTest {
        val repository = mockk<NotificationPreferencesRepository>()
        coEvery { repository.getMyPreferences() } returns NotificationPreferencesResult.Loaded(listOf(samplePreference))
        coEvery {
            repository.setChannelEnabled(NotificationCategory.MAINTENANCE, emailEnabled = false, pushEnabled = true, whatsappEnabled = true)
        } returns UpdatePreferenceResult.Success

        val viewModel = NotificationPreferencesViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.toggle(samplePreference, NotificationPreferencesViewModel.Channel.EMAIL, false)
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) {
            repository.setChannelEnabled(NotificationCategory.MAINTENANCE, emailEnabled = false, pushEnabled = true, whatsappEnabled = true)
        }
        coVerify(exactly = 2) { repository.getMyPreferences() }
        assertEquals(null, viewModel.busyCategory.value)
    }

    @Test
    fun `toggle does nothing while preferences have not loaded yet`() = runTest {
        val repository = mockk<NotificationPreferencesRepository>()
        coEvery { repository.getMyPreferences() } returns NotificationPreferencesResult.Error("network error")

        val viewModel = NotificationPreferencesViewModel(repository)
        // Do not advance the dispatcher: state is still Loading.

        viewModel.toggle(samplePreference, NotificationPreferencesViewModel.Channel.EMAIL, false)
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 0) { repository.setChannelEnabled(any(), any(), any(), any()) }
    }
}
