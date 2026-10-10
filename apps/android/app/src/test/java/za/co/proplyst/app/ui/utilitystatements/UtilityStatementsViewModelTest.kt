package za.co.proplyst.app.ui.utilitystatements

import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import za.co.proplyst.app.data.utilitystatements.UtilityStatement
import za.co.proplyst.app.data.utilitystatements.UtilityStatementLine
import za.co.proplyst.app.data.utilitystatements.UtilityStatementsRepository
import za.co.proplyst.app.data.utilitystatements.UtilityStatementsResult

@OptIn(ExperimentalCoroutinesApi::class)
class UtilityStatementsViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val statement = UtilityStatement(
        id = "s1",
        propertyName = "Hybrid House",
        unitLabel = "Flatlet",
        periodStart = "2026-09-01",
        periodEnd = "2026-09-30",
        total = 450.0,
        vat = 58.70,
        lines = listOf(UtilityStatementLine("electricity", "Electricity — metered usage", "2026-09-01 to 2026-09-30", 0.0, 150.0, 150.0, "kWh", false, "Flat R3", 450.0, 0.0)),
        notes = emptyList(),
    )

    @Test
    fun `shows approved statements from the server unchanged`() = runTest {
        val repository = mockk<UtilityStatementsRepository>()
        coEvery { repository.getMyStatements() } returns UtilityStatementsResult.Loaded(listOf(statement))
        val viewModel = UtilityStatementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()
        val state = viewModel.uiState.value
        assertTrue(state is UtilityStatementsUiState.Loaded)
        assertEquals(450.0, (state as UtilityStatementsUiState.Loaded).statements.single().total, 0.0)
    }

    @Test
    fun `empty and error states`() = runTest {
        val empty = mockk<UtilityStatementsRepository>()
        coEvery { empty.getMyStatements() } returns UtilityStatementsResult.Loaded(emptyList())
        val vm1 = UtilityStatementsViewModel(empty)
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue(vm1.uiState.value is UtilityStatementsUiState.Empty)

        val failing = mockk<UtilityStatementsRepository>()
        coEvery { failing.getMyStatements() } returns UtilityStatementsResult.Error("offline")
        val vm2 = UtilityStatementsViewModel(failing)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(UtilityStatementsUiState.Error("offline"), vm2.uiState.value)
    }

    @Test
    fun `toggling expands one statement at a time`() = runTest {
        val repository = mockk<UtilityStatementsRepository>()
        coEvery { repository.getMyStatements() } returns UtilityStatementsResult.Loaded(listOf(statement))
        val viewModel = UtilityStatementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.toggle("s1")
        assertEquals("s1", viewModel.expandedId.value)
        viewModel.toggle("s1")
        assertNull(viewModel.expandedId.value)
    }
}
