package za.co.proplyst.app.data.units

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockUnitsRepositoryTest {

    @Test
    fun `getUnitsByProperty returns only units for the requested property`() = runTest {
        val repository = MockUnitsRepository()

        val result = repository.getUnitsByProperty("demo-property-1")

        assertTrue(result is UnitsResult.Live)
        val live = result as UnitsResult.Live
        assertEquals(2, live.units.size)
        assertTrue(live.units.all { it.propertyId == "demo-property-1" })
    }

    @Test
    fun `getUnitsByProperty returns an empty list for an unknown property`() = runTest {
        val repository = MockUnitsRepository()

        val result = repository.getUnitsByProperty("does-not-exist")

        assertTrue(result is UnitsResult.Live)
        assertEquals(0, (result as UnitsResult.Live).units.size)
    }

    @Test
    fun `getUnitById returns the matching fixture unit`() = runTest {
        val repository = MockUnitsRepository()

        val unit = repository.getUnitById("demo-unit-1")

        assertEquals("Unit 4B", unit?.unitLabel)
    }

    @Test
    fun `getUnitById returns null for an unknown id`() = runTest {
        val repository = MockUnitsRepository()

        val unit = repository.getUnitById("does-not-exist")

        assertEquals(null, unit)
    }
}
