package za.co.proplyst.app.ui.utilities

import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import za.co.proplyst.app.data.financials.FinancialSummary
import za.co.proplyst.app.data.financials.FinancialSummaryRepository
import za.co.proplyst.app.data.financials.FinancialSummaryResult
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult
import za.co.proplyst.app.data.utilities.UtilityHistoryPoint
import za.co.proplyst.app.data.utilities.UtilityHistoryResult
import za.co.proplyst.app.data.utilities.UtilityMeter
import za.co.proplyst.app.data.utilities.UtilityMetersResult
import za.co.proplyst.app.data.utilities.UtilitiesRepository

/**
 * V1 owner-app completion pass (WORKLOG.md this date): the new Utility Overview screen must never
 * show a fabricated owner cost next to a tenant-prepaid meter, and must always read consumption
 * trend/anomaly figures straight from the server's own history points rather than recomputing them
 * (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UtilityOverviewViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun property(id: String = "property-1") = Property(
        id = id,
        orgId = "org-1",
        nickname = "Test Property",
        fullAddress = "1 Test St",
        city = "Cape Town",
        province = null,
        propertyType = "house",
        municipalAccountNumber = null,
        notes = null,
        status = "active",
    )

    private fun meter(
        id: String,
        utilityType: String,
        responsibilityMode: String,
        isPrepaid: Boolean = false,
    ) = UtilityMeter(
        id = id,
        propertyId = "property-1",
        unitId = null,
        utilityType = utilityType,
        meterNumber = "M-$id",
        responsibilityMode = responsibilityMode,
        isPrepaid = isPrepaid,
        active = true,
    )

    private fun historyPoint(
        readingValue: Double = 120.0,
        consumption: Double? = 20.0,
        previousConsumption: Double? = 15.0,
        percentChange: Double? = 33.3,
        isUnusualUsage: Boolean = false,
    ) = UtilityHistoryPoint(
        periodMonth = "2026-09-01",
        readingValue = readingValue,
        consumption = consumption,
        previousConsumption = previousConsumption,
        percentChange = percentChange,
        isUnusualUsage = isUnusualUsage,
    )

    private fun financialSummary() = FinancialSummary(
        month = "2026-09-01",
        rentPlanned = 12500.0,
        rentCollected = 12500.0,
        rentOutstanding = 0.0,
        utilitiesExpense = 900.0,
        waterExpense = 400.0,
        electricityExpense = 500.0,
        ratesAndLeviesExpense = 0.0,
        otherExpenses = 0.0,
        totalExpenses = 900.0,
        budgetPlanned = null,
        budgetUsedPercent = null,
        budgetRemaining = null,
        netOperatingPosition = 11600.0,
        awaitingConfirmationCount = 0,
        budgetAlertLevel = null,
    )

    @Test
    fun `splits meters by utility type and reads trend figures straight from the server's history point`() = runTest {
        val propertiesRepository = mockk<PropertiesRepository>()
        coEvery { propertiesRepository.getProperties() } returns PropertiesResult.Live(listOf(property()))
        val waterMeter = meter("water-1", "water", "owner_paid")
        val electricityMeter = meter("elec-1", "electricity", "owner_paid")
        val utilitiesRepository = mockk<UtilitiesRepository>()
        coEvery { utilitiesRepository.getMeters("property-1", null) } returns
            UtilityMetersResult.Loaded(listOf(waterMeter, electricityMeter))
        coEvery { utilitiesRepository.getReadingHistory("water-1") } returns
            UtilityHistoryResult.Loaded(listOf(historyPoint(consumption = 1200.0, isUnusualUsage = true)))
        coEvery { utilitiesRepository.getReadingHistory("elec-1") } returns
            UtilityHistoryResult.Loaded(listOf(historyPoint(consumption = 300.0)))
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()
        coEvery { financialSummaryRepository.getFinancialSummary("property-1", any()) } returns
            FinancialSummaryResult.Loaded(financialSummary())

        val vm = UtilityOverviewViewModel(propertiesRepository, utilitiesRepository, financialSummaryRepository)
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(1, state.waterMeters.size)
        assertEquals(1200.0, state.waterMeters.first().currentPeriodUsage)
        assertTrue(state.waterMeters.first().isUnusualUsage)
        assertEquals(1, state.electricityMeters.size)
        assertEquals(300.0, state.electricityMeters.first().currentPeriodUsage)
        assertEquals(false, state.electricityMeters.first().isUnusualUsage)
    }

    @Test
    fun `owner cost is attached when a meter is owner-paid`() = runTest {
        val propertiesRepository = mockk<PropertiesRepository>()
        coEvery { propertiesRepository.getProperties() } returns PropertiesResult.Live(listOf(property()))
        val waterMeter = meter("water-1", "water", "owner_paid")
        val utilitiesRepository = mockk<UtilitiesRepository>()
        coEvery { utilitiesRepository.getMeters("property-1", null) } returns UtilityMetersResult.Loaded(listOf(waterMeter))
        coEvery { utilitiesRepository.getReadingHistory("water-1") } returns UtilityHistoryResult.Loaded(listOf(historyPoint()))
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()
        coEvery { financialSummaryRepository.getFinancialSummary("property-1", any()) } returns
            FinancialSummaryResult.Loaded(financialSummary())

        val vm = UtilityOverviewViewModel(propertiesRepository, utilitiesRepository, financialSummaryRepository)
        advanceUntilIdle()

        assertEquals(400.0, vm.uiState.value.waterExpenseThisMonth)
        assertNull(vm.uiState.value.electricityExpenseThisMonth)
    }

    @Test
    fun `a tenant-prepaid meter never shows an owner cost, and the financial summary is never fetched when nothing is owner-paid`() = runTest {
        val propertiesRepository = mockk<PropertiesRepository>()
        coEvery { propertiesRepository.getProperties() } returns PropertiesResult.Live(listOf(property()))
        val waterMeter = meter("water-1", "water", "tenant_prepaid", isPrepaid = true)
        val utilitiesRepository = mockk<UtilitiesRepository>()
        coEvery { utilitiesRepository.getMeters("property-1", null) } returns UtilityMetersResult.Loaded(listOf(waterMeter))
        coEvery { utilitiesRepository.getReadingHistory("water-1") } returns UtilityHistoryResult.Loaded(listOf(historyPoint()))
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()

        val vm = UtilityOverviewViewModel(propertiesRepository, utilitiesRepository, financialSummaryRepository)
        advanceUntilIdle()

        assertNull(vm.uiState.value.waterExpenseThisMonth)
        io.mockk.coVerify(exactly = 0) { financialSummaryRepository.getFinancialSummary(any(), any()) }
    }

    @Test
    fun `no meter of a utility type yields an empty list for that section`() = runTest {
        val propertiesRepository = mockk<PropertiesRepository>()
        coEvery { propertiesRepository.getProperties() } returns PropertiesResult.Live(listOf(property()))
        val waterMeter = meter("water-1", "water", "owner_paid")
        val utilitiesRepository = mockk<UtilitiesRepository>()
        coEvery { utilitiesRepository.getMeters("property-1", null) } returns UtilityMetersResult.Loaded(listOf(waterMeter))
        coEvery { utilitiesRepository.getReadingHistory("water-1") } returns UtilityHistoryResult.Loaded(listOf(historyPoint()))
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()
        coEvery { financialSummaryRepository.getFinancialSummary("property-1", any()) } returns
            FinancialSummaryResult.Loaded(financialSummary())

        val vm = UtilityOverviewViewModel(propertiesRepository, utilitiesRepository, financialSummaryRepository)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.electricityMeters.isEmpty())
    }

    @Test
    fun `selecting a different property reloads its own meters`() = runTest {
        val propertiesRepository = mockk<PropertiesRepository>()
        coEvery { propertiesRepository.getProperties() } returns
            PropertiesResult.Live(listOf(property("property-1"), property("property-2")))
        val utilitiesRepository = mockk<UtilitiesRepository>()
        coEvery { utilitiesRepository.getMeters("property-1", null) } returns
            UtilityMetersResult.Loaded(listOf(meter("water-1", "water", "owner_paid")))
        coEvery { utilitiesRepository.getReadingHistory("water-1") } returns UtilityHistoryResult.Loaded(listOf(historyPoint()))
        coEvery { utilitiesRepository.getMeters("property-2", null) } returns UtilityMetersResult.Loaded(emptyList())
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()
        coEvery { financialSummaryRepository.getFinancialSummary(any(), any()) } returns FinancialSummaryResult.Loaded(financialSummary())

        val vm = UtilityOverviewViewModel(propertiesRepository, utilitiesRepository, financialSummaryRepository)
        advanceUntilIdle()
        assertEquals(1, vm.uiState.value.waterMeters.size)

        vm.selectProperty("property-2")
        advanceUntilIdle()

        assertEquals("property-2", vm.uiState.value.selectedPropertyId)
        assertTrue(vm.uiState.value.waterMeters.isEmpty())
    }
}
