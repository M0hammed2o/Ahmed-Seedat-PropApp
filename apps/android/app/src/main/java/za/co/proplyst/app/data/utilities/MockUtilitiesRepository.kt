package za.co.proplyst.app.data.utilities

import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MockUtilitiesRepository @Inject constructor() : UtilitiesRepository {

    override suspend fun getMeters(propertyId: String, unitId: String?): UtilityMetersResult {
        delay(200)
        return UtilityMetersResult.Loaded(
            listOf(
                UtilityMeter("mock-meter-water", propertyId, unitId, "water", "WM-001", "owner_paid", false, true),
                UtilityMeter("mock-meter-elec", propertyId, unitId, "electricity", "EM-001", "owner_paid", false, true),
            ),
        )
    }

    override suspend fun getReadingHistory(meterId: String): UtilityHistoryResult {
        delay(200)
        return UtilityHistoryResult.Loaded(
            listOf(
                UtilityHistoryPoint("2026-07-01", 0.0, null, null, null, false),
                UtilityHistoryPoint("2026-08-01", 1000.0, 1000.0, null, null, false),
                UtilityHistoryPoint("2026-09-01", 2200.0, 1200.0, 1000.0, 20.0, true),
            ),
        )
    }

    override suspend fun recordReading(
        orgId: String,
        propertyId: String,
        meterId: String,
        utilityType: String,
        periodMonth: String,
        readingDate: String,
        readingValue: Double,
        unitOfMeasure: String,
        evidenceUri: android.net.Uri?,
        notes: String?,
    ): UtilityReadingSubmitResult {
        delay(300)
        return UtilityReadingSubmitResult.Success
    }
}
