package com.propertyvault.app.data.leases

import kotlinx.coroutines.delay
import javax.inject.Inject

/** Fixture lease under "demo-unit-1" -- the occupied unit in MockUnitsRepository's fixture, so an
 * occupied unit having an active lease is a coherent demo, same continuity rule the Units/Tenants
 * fixtures already follow. */
class MockLeasesRepository @Inject constructor() : LeasesRepository {

    private val fixture = listOf(
        Lease(
            id = "demo-lease-1",
            orgId = "demo-org-1",
            unitId = "demo-unit-1",
            startDate = "2026-02-01",
            endDate = "2027-01-31",
            rentAmount = 10650.0,
            rentFrequency = "monthly",
            depositAmount = 10650.0,
            status = "active",
        ),
    )

    override suspend fun getLeasesByUnit(unitId: String): LeasesResult {
        delay(400)
        return LeasesResult.Live(fixture.filter { it.unitId == unitId })
    }

    override suspend fun getLeaseById(id: String): Lease? {
        delay(200)
        return fixture.firstOrNull { it.id == id }
    }
}
