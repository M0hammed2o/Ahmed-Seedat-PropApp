package za.co.proplyst.app.data.units

import kotlinx.coroutines.delay
import javax.inject.Inject

/** Deterministic fixture data, matching MockPropertiesRepository's own pattern -- units belong to
 * "demo-property-1", the same fixture id MockPropertiesRepository uses, so the demo flow from
 * Properties list -> Property detail -> Units list is coherent end to end. */
class MockUnitsRepository @Inject constructor() : UnitsRepository {

    private val fixture = listOf(
        PropertyUnit(
            id = "demo-unit-1",
            propertyId = "demo-property-1",
            orgId = "demo-org-1",
            unitLabel = "Unit 4B",
            bedrooms = 2,
            bathrooms = 1,
            sizeSqm = 65.0,
            marketRent = 10650.0,
            status = "occupied",
        ),
        PropertyUnit(
            id = "demo-unit-2",
            propertyId = "demo-property-1",
            orgId = "demo-org-1",
            unitLabel = "Unit 5A",
            bedrooms = 1,
            bathrooms = 1,
            sizeSqm = 45.0,
            marketRent = 8200.0,
            status = "vacant",
        ),
    )

    override suspend fun getUnitsByProperty(propertyId: String): UnitsResult {
        delay(400)
        return UnitsResult.Live(fixture.filter { it.propertyId == propertyId })
    }

    override suspend fun getUnitById(id: String): PropertyUnit? {
        delay(200)
        return fixture.firstOrNull { it.id == id }
    }
}
