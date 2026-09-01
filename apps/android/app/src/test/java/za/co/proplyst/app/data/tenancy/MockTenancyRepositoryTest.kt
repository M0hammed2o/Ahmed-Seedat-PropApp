package za.co.proplyst.app.data.tenancy

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertTrue
import org.junit.Test

class MockTenancyRepositoryTest {
    @Test
    fun `getMyLease returns a deterministic fixture lease`() = runTest {
        val repository = MockTenancyRepository()
        val result = repository.getMyLease()
        assertTrue(result is TenancyLeaseResult.Loaded)
    }
}
