package com.propertyvault.app.data.tenants

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockTenantsRepositoryTest {

    @Test
    fun `getTenants returns the fixture as Live data`() = runTest {
        val repository = MockTenantsRepository()

        val result = repository.getTenants()

        assertTrue(result is TenantsResult.Live)
        val live = result as TenantsResult.Live
        assertEquals(1, live.tenants.size)
        assertEquals("Naledi Khumalo", live.tenants.first().fullName)
    }

    @Test
    fun `getTenantById returns the matching fixture tenant`() = runTest {
        val repository = MockTenantsRepository()

        val tenant = repository.getTenantById("demo-tenant-1")

        assertEquals("Naledi Khumalo", tenant?.fullName)
    }

    @Test
    fun `getTenantById returns null for an unknown id`() = runTest {
        val repository = MockTenantsRepository()

        val tenant = repository.getTenantById("does-not-exist")

        assertEquals(null, tenant)
    }
}
