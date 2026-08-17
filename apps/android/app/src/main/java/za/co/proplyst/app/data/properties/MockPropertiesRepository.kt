package za.co.proplyst.app.data.properties

import kotlinx.coroutines.delay
import javax.inject.Inject

/**
 * Deterministic fixture data, matching apps/admin's own demo-mode pattern (ADMIN_DEMO_MODE) --
 * never wired into the same binding as PostgrestPropertiesRepository (Mohammed's explicit
 * instruction: "do not mix mock behaviour into the real repository implementation"). Selected via
 * a build-time DI choice in di/RepositoryModule.kt, not a runtime flag inside the real
 * implementation.
 */
class MockPropertiesRepository @Inject constructor() : PropertiesRepository {

    private val fixture = listOf(
        Property(
            id = "demo-property-1",
            orgId = "demo-org-1",
            nickname = "Sea Point Apartment",
            fullAddress = "12 Main Road, Sea Point, Cape Town, 8005",
            city = "Cape Town",
            province = "Western Cape",
            propertyType = "apartment",
            municipalAccountNumber = null,
            notes = null,
            status = "active",
        ),
    )

    override suspend fun getProperties(): PropertiesResult {
        delay(400) // simulated latency so loading states are actually visible during development
        return PropertiesResult.Live(fixture)
    }

    override suspend fun getPropertyById(id: String): Property? {
        delay(200)
        return fixture.firstOrNull { it.id == id }
    }
}
