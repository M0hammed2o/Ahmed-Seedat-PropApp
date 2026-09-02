package za.co.proplyst.app.data.properties

import android.content.Context
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockPropertiesRepositoryTest {

    private fun repository(): MockPropertiesRepository {
        val context = mockk<Context>()
        every { context.packageName } returns "za.co.proplyst.app"
        return MockPropertiesRepository(context)
    }

    @Test
    fun `getProperties returns the fixture as Live data, each with a real cover photo`() = runTest {
        val result = repository().getProperties()

        assertTrue(result is PropertiesResult.Live)
        val live = result as PropertiesResult.Live
        assertEquals(3, live.properties.size)
        assertEquals("Edendale Apartments", live.properties.first().nickname)
        live.properties.forEach { property ->
            assertTrue("every fixture property must have a cover photo URI", !property.coverPhotoUrl.isNullOrBlank())
            assertTrue("occupied units must never exceed unit count", property.occupiedUnitCount <= property.unitCount)
        }
    }

    @Test
    fun `getPropertyById returns the matching fixture property`() = runTest {
        val property = repository().getPropertyById("demo-property-1")

        assertEquals("Edendale Apartments", property?.nickname)
    }

    @Test
    fun `getPropertyById returns null for an unknown id`() = runTest {
        val property = repository().getPropertyById("does-not-exist")

        assertEquals(null, property)
    }
}
