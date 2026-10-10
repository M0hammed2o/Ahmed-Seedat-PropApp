package za.co.proplyst.app.data.utilitystatements

import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MockUtilityStatementsRepository @Inject constructor() : UtilityStatementsRepository {
    override suspend fun getMyStatements(): UtilityStatementsResult {
        delay(300)
        return UtilityStatementsResult.Loaded(
            listOf(
                UtilityStatement(
                    id = "demo-utility-statement-1",
                    propertyName = "Demo Court",
                    unitLabel = "Unit 2",
                    periodStart = "2026-09-01",
                    periodEnd = "2026-09-30",
                    total = 810.0,
                    vat = 105.65,
                    lines = listOf(
                        UtilityStatementLine("electricity", "Electricity — metered usage", "2026-09-01 to 2026-09-30", 1000.0, 1150.0, 150.0, "kWh", false, "Demo flat rate", 450.0, 0.0),
                        UtilityStatementLine("water", "Water — metered usage", "2026-09-01 to 2026-09-30", 100.0, 112.0, 12.0, "kL", false, "Demo block tariff", 360.0, 0.0),
                    ),
                    notes = listOf("Amounts include VAT where the tariff includes VAT."),
                ),
            ),
        )
    }
}
