package za.co.proplyst.app.ui.properties

import za.co.proplyst.app.data.financials.FinancialSummary
import za.co.proplyst.app.data.financials.FinancialSummaryRepository
import za.co.proplyst.app.data.financials.FinancialSummaryResult
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * `dispatcher.scheduler.advanceUntilIdle()` (not Turbine) is used deliberately -- StateFlow's
 * `init { load() }` launches on `viewModelScope` (Dispatchers.Main, set to this test's
 * StandardTestDispatcher below), which needs its own scheduler advanced independently of
 * `runTest`'s own virtual-time scope. Kept simple and explicit rather than layering a stream-
 * assertion library on top, since this is unverified until a real `gradle test` run confirms it
 * compiles and passes -- see WORKLOG.md.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PropertiesListViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    /** V1 owner-app completion pass (WORKLOG.md this date): every existing test's ViewModel now
     *  needs a [FinancialSummaryRepository] too, since the health-card financials load alongside
     *  the properties themselves. A pre-stubbed failure keeps every prior test's assertions about
     *  `properties`/`cachedAt` unaffected -- only the new tests below stub real summaries. */
    private fun noFinancials(): FinancialSummaryRepository {
        val repo = mockk<FinancialSummaryRepository>()
        coEvery { repo.getFinancialSummary(any(), any()) } returns FinancialSummaryResult.Error("not stubbed for this test")
        return repo
    }

    private val sampleProperty = Property(
        id = "p1",
        orgId = "org1",
        nickname = "Test Property",
        fullAddress = "1 Test St",
        city = "Cape Town",
        province = null,
        propertyType = "house",
        municipalAccountNumber = null,
        notes = null,
        status = "active",
    )

    @Test
    fun `emits Loaded when the repository returns live properties`() = runTest {
        val repository = mockk<PropertiesRepository>()
        coEvery { repository.getProperties() } returns PropertiesResult.Live(listOf(sampleProperty))

        val viewModel = PropertiesListViewModel(repository, noFinancials())
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is PropertiesListUiState.Loaded)
        state as PropertiesListUiState.Loaded
        assertEquals(listOf(sampleProperty), state.properties)
        assertNull(state.cachedAt)
    }

    @Test
    fun `emits Empty when the repository returns no properties`() = runTest {
        val repository = mockk<PropertiesRepository>()
        coEvery { repository.getProperties() } returns PropertiesResult.Live(emptyList())

        val viewModel = PropertiesListViewModel(repository, noFinancials())
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is PropertiesListUiState.Empty)
    }

    @Test
    fun `emits Loaded with a cachedAt timestamp when the repository falls back to cache`() = runTest {
        val repository = mockk<PropertiesRepository>()
        coEvery { repository.getProperties() } returns PropertiesResult.Cached(listOf(sampleProperty), 1_700_000_000_000L)

        val viewModel = PropertiesListViewModel(repository, noFinancials())
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is PropertiesListUiState.Loaded)
        assertNotNull((state as PropertiesListUiState.Loaded).cachedAt)
    }

    @Test
    fun `emits Error when the repository fails with no cache to fall back to`() = runTest {
        val repository = mockk<PropertiesRepository>()
        coEvery { repository.getProperties() } returns PropertiesResult.Error("network error")

        val viewModel = PropertiesListViewModel(repository, noFinancials())
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is PropertiesListUiState.Error)
        assertEquals("network error", (state as PropertiesListUiState.Error).message)
    }

    // Proplyst Mobile Design System redesign pass: the Properties grid header's search field and
    // "All / Residential / Commercial / Land" filter chips are real client-side filters, not
    // decorative -- these assert they actually narrow uiState.
    private val houseProperty = sampleProperty.copy(id = "p1", nickname = "Beach House", propertyType = "house")
    private val retailProperty = sampleProperty.copy(id = "p2", nickname = "Corner Retail Unit", propertyType = "retail", fullAddress = "9 Long St")

    @Test
    fun `search query narrows the loaded list by nickname or address, case-insensitively`() = runTest {
        val repository = mockk<PropertiesRepository>()
        coEvery { repository.getProperties() } returns PropertiesResult.Live(listOf(houseProperty, retailProperty))

        val viewModel = PropertiesListViewModel(repository, noFinancials())
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.onSearchQueryChange("beach")

        val state = viewModel.uiState.value
        assertTrue(state is PropertiesListUiState.Loaded)
        assertEquals(listOf(houseProperty), (state as PropertiesListUiState.Loaded).properties)
    }

    @Test
    fun `category filter narrows the loaded list to the matching property types`() = runTest {
        val repository = mockk<PropertiesRepository>()
        coEvery { repository.getProperties() } returns PropertiesResult.Live(listOf(houseProperty, retailProperty))

        val viewModel = PropertiesListViewModel(repository, noFinancials())
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.onCategoryFilterChange(PropertyCategoryFilter.RESIDENTIAL)

        val state = viewModel.uiState.value
        assertTrue(state is PropertiesListUiState.Loaded)
        assertEquals(listOf(houseProperty), (state as PropertiesListUiState.Loaded).properties)
    }

    @Test
    fun `a search with zero matches shows a distinct message from a genuinely empty portfolio`() = runTest {
        val repository = mockk<PropertiesRepository>()
        coEvery { repository.getProperties() } returns PropertiesResult.Live(listOf(houseProperty))

        val viewModel = PropertiesListViewModel(repository, noFinancials())
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.onSearchQueryChange("no such property")

        val state = viewModel.uiState.value
        assertTrue(state is PropertiesListUiState.Empty)
        assertEquals("No properties match your search", (state as PropertiesListUiState.Empty).message)
    }

    // V1 owner-app completion pass (WORKLOG.md this date): property list health cards -- each
    // card's rent-collected/budget-status/attention figures come from the property's own real
    // financial summary, never a fabricated or portfolio-wide figure.
    private fun financialSummary(
        rentOutstanding: Double = 0.0,
        budgetPlanned: Double? = 20000.0,
        budgetAlertLevel: String? = null,
        awaitingConfirmationCount: Int = 0,
    ) = FinancialSummary(
        month = "2026-09-01",
        rentPlanned = 10000.0,
        rentCollected = 9500.0,
        rentOutstanding = rentOutstanding,
        utilitiesExpense = 0.0,
        ratesAndLeviesExpense = 0.0,
        otherExpenses = 0.0,
        totalExpenses = 8000.0,
        budgetPlanned = budgetPlanned,
        budgetUsedPercent = 40.0,
        budgetRemaining = 12000.0,
        netOperatingPosition = 1500.0,
        awaitingConfirmationCount = awaitingConfirmationCount,
        budgetAlertLevel = budgetAlertLevel,
    )

    @Test
    fun `each card's financial summary is fetched by its own property id`() = runTest {
        val repository = mockk<PropertiesRepository>()
        coEvery { repository.getProperties() } returns PropertiesResult.Live(listOf(houseProperty, retailProperty))
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()
        coEvery { financialSummaryRepository.getFinancialSummary("p1", any()) } returns FinancialSummaryResult.Loaded(financialSummary())
        coEvery { financialSummaryRepository.getFinancialSummary("p2", any()) } returns FinancialSummaryResult.Error("failed")

        val viewModel = PropertiesListViewModel(repository, financialSummaryRepository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value as PropertiesListUiState.Loaded
        assertEquals(9500.0, state.financials["p1"]?.rentCollected)
        assertNull(state.financials["p2"])
    }

    @Test
    fun `budgetStatusFor reflects the server's own alert level, never a client threshold`() {
        assertEquals(PropertyBudgetStatus.NOT_CONFIGURED, budgetStatusFor(financialSummary(budgetPlanned = null)))
        assertEquals(PropertyBudgetStatus.OVER_BUDGET, budgetStatusFor(financialSummary(budgetAlertLevel = "exceeded")))
        assertEquals(PropertyBudgetStatus.APPROACHING, budgetStatusFor(financialSummary(budgetAlertLevel = "approaching")))
        assertEquals(PropertyBudgetStatus.ON_TRACK, budgetStatusFor(financialSummary()))
        assertEquals(PropertyBudgetStatus.NOT_CONFIGURED, budgetStatusFor(null))
    }

    @Test
    fun `needsAttention is true for outstanding rent, a budget alert, or an awaiting-confirmation payment`() {
        assertTrue(needsAttention(financialSummary(rentOutstanding = 500.0)))
        assertTrue(needsAttention(financialSummary(budgetAlertLevel = "approaching")))
        assertTrue(needsAttention(financialSummary(awaitingConfirmationCount = 1)))
        assertTrue(!needsAttention(financialSummary()))
        assertTrue(!needsAttention(null))
    }
}
