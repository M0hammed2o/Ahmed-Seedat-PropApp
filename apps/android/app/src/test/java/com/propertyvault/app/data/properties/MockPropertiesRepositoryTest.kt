package com.propertyvault.app.data.properties

import com.propertyvault.app.data.properties.PropertiesResult
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockPropertiesRepositoryTest {

    @Test
    fun `getProperties returns the fixture as Live data`() = runTest {
        val repository = MockPropertiesRepository()

        val result = repository.getProperties()

        assertTrue(result is PropertiesResult.Live)
        val live = result as PropertiesResult.Live
        assertEquals(1, live.properties.size)
        assertEquals("Sea Point Apartment", live.properties.first().nickname)
    }

    @Test
    fun `getPropertyById returns the matching fixture property`() = runTest {
        val repository = MockPropertiesRepository()

        val property = repository.getPropertyById("demo-property-1")

        assertEquals("Sea Point Apartment", property?.nickname)
    }

    @Test
    fun `getPropertyById returns null for an unknown id`() = runTest {
        val repository = MockPropertiesRepository()

        val property = repository.getPropertyById("does-not-exist")

        assertEquals(null, property)
    }
}
