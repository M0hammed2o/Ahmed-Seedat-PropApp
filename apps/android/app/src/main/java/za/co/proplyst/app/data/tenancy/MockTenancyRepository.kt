package za.co.proplyst.app.data.tenancy

import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

/** Deterministic fixture -- under the same `demo-property-1`/`demo-unit-1` ids every other
 * Mock*Repository already uses. Never wired into the same binding as
 * PostgrestTenancyRepository. */
@Singleton
class MockTenancyRepository @Inject constructor() : TenancyRepository {
    override suspend fun getMyLease(): TenancyLeaseResult {
        delay(300)
        return TenancyLeaseResult.Loaded(
            TenancyLease(
                tenantId = "demo-tenant-1",
                orgId = "demo-org-1",
                propertyNickname = "Musgrave Flats",
                propertyAddress = "12 Musgrave Road, Durban",
                unitLabel = "Unit 601",
                leaseStatus = "active",
                startDate = "2026-02-01",
                endDate = null,
                rentAmount = 20000.0,
            ),
        )
    }
}
