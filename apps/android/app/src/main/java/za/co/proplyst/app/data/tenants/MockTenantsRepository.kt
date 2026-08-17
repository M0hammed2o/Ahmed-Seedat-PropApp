package za.co.proplyst.app.data.tenants

import kotlinx.coroutines.delay
import javax.inject.Inject

class MockTenantsRepository @Inject constructor() : TenantsRepository {

    private val fixture = listOf(
        Tenant(
            id = "demo-tenant-1",
            orgId = "demo-org-1",
            fullName = "Naledi Khumalo",
            email = "naledi@example.com",
            phone = "+27 82 555 0101",
            status = "active",
        ),
    )

    override suspend fun getTenants(): TenantsResult {
        delay(400)
        return TenantsResult.Live(fixture)
    }

    override suspend fun getTenantById(id: String): Tenant? {
        delay(200)
        return fixture.firstOrNull { it.id == id }
    }
}
