package za.co.proplyst.app.data.ownersummary

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockOwnerSummaryRepositoryTest {

    @Test
    fun `getMySummaries returns the fixture as Loaded`() = runTest {
        val repository = MockOwnerSummaryRepository()

        val result = repository.getMySummaries()

        assertTrue(result is OwnerSummaryResult.Loaded)
        val summaries = (result as OwnerSummaryResult.Loaded).summaries
        assertEquals(1, summaries.size)
        val summary = summaries.first()
        assertEquals("demo-summary-1", summary.id)
        assertEquals(2, summary.propertyCount)
        assertEquals(21300.0, summary.expectedRent, 0.0)
    }
}
