package za.co.proplyst.app.data.properties

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import za.co.proplyst.app.R
import javax.inject.Inject

/**
 * Deterministic fixture data, matching apps/admin's own demo-mode pattern (ADMIN_DEMO_MODE) --
 * never wired into the same binding as PostgrestPropertiesRepository (Mohammed's explicit
 * instruction: "do not mix mock behaviour into the real repository implementation"). Selected via
 * a build-time DI choice in di/RepositoryModule.kt, not a runtime flag inside the real
 * implementation.
 *
 * Proplyst Mobile Design System redesign pass: three fixtures (was one), using the approved design
 * handoff's own property photos (`res/drawable-nodpi/prop_*.png`, copied from
 * `design/.../assets/`) via an `android.resource://` URI -- Coil loads this exactly like any real
 * signed URL, so [za.co.proplyst.app.ui.properties.PropertiesListScreen] never needs to know
 * whether it's rendering mock or real data. Unit/occupancy counts are plain fixture integers, same
 * "deterministic, never randomized" posture as every other mock repository in this app.
 */
class MockPropertiesRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) : PropertiesRepository {

    private fun resourceUri(resId: Int) = "android.resource://${context.packageName}/$resId"

    private val fixture by lazy {
        listOf(
            Property(
                id = "demo-property-1",
                orgId = "demo-org-1",
                nickname = "Edendale Apartments",
                fullAddress = "12 Main Road, Sea Point, Cape Town, 8005",
                city = "Cape Town",
                province = "Western Cape",
                propertyType = "apartment_building",
                municipalAccountNumber = null,
                notes = null,
                status = "active",
                coverPhotoUrl = resourceUri(R.drawable.prop_edendale),
                unitCount = 8,
                occupiedUnitCount = 7,
            ),
            Property(
                id = "demo-property-2",
                orgId = "demo-org-1",
                nickname = "Northdale Court",
                fullAddress = "45 Voortrekker Street, Northdale, Pietermaritzburg, 3201",
                city = "Pietermaritzburg",
                province = "KwaZulu-Natal",
                propertyType = "townhouse",
                municipalAccountNumber = null,
                notes = null,
                status = "active",
                coverPhotoUrl = resourceUri(R.drawable.prop_northdale),
                unitCount = 4,
                occupiedUnitCount = 4,
            ),
            Property(
                id = "demo-property-3",
                orgId = "demo-org-1",
                nickname = "Salta Retail Park",
                fullAddress = "3 Salta Road, Salt River, Cape Town, 7925",
                city = "Cape Town",
                province = "Western Cape",
                propertyType = "retail",
                municipalAccountNumber = null,
                notes = null,
                status = "active",
                coverPhotoUrl = resourceUri(R.drawable.prop_salta),
                unitCount = 3,
                occupiedUnitCount = 2,
            ),
        )
    }

    override suspend fun getProperties(): PropertiesResult {
        delay(400) // simulated latency so loading states are actually visible during development
        return PropertiesResult.Live(fixture)
    }

    override suspend fun getPropertyById(id: String): Property? {
        delay(200)
        return fixture.firstOrNull { it.id == id }
    }
}
