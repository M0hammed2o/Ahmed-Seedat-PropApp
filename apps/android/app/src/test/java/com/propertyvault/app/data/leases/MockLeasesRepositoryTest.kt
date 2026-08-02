package com.propertyvault.app.data.leases

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockLeasesRepositoryTest {

    @Test
    fun `getLeasesByUnit returns only leases for the requested unit`() = runTest {
        val repository = MockLeasesRepository()

        val result = repository.getLeasesByUnit("demo-unit-1")

        assertTrue(result is LeasesResult.Live)
        val live = result as LeasesResult.Live
        assertEquals(1, live.leases.size)
        assertTrue(live.leases.all { it.unitId == "demo-unit-1" })
    }

    @Test
    fun `getLeasesByUnit returns an empty list for a unit with no lease`() = runTest {
        val repository = MockLeasesRepository()

        val result = repository.getLeasesByUnit("demo-unit-2")

        assertTrue(result is LeasesResult.Live)
        assertEquals(0, (result as LeasesResult.Live).leases.size)
    }

    @Test
    fun `getLeaseById returns the matching fixture lease`() = runTest {
        val repository = MockLeasesRepository()

        val lease = repository.getLeaseById("demo-lease-1")

        assertEquals("active", lease?.status)
    }

    @Test
    fun `getLeaseById returns null for an unknown id`() = runTest {
        val repository = MockLeasesRepository()

        val lease = repository.getLeaseById("does-not-exist")

        assertEquals(null, lease)
    }
}
