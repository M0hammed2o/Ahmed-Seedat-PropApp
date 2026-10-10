package za.co.proplyst.app.data.utilitystatements

/** A tenant's approved monthly utility statement (hybrid utilities, docs/HYBRID_UTILITIES_ARCHITECTURE.md §F).
 * Every figure is the server's immutable snapshot -- nothing is recalculated on the device. */
data class UtilityStatementLine(
    val utility: String,
    val description: String,
    val segment: String,
    val opening: Double?,
    val closing: Double?,
    val consumption: Double?,
    val unit: String,
    val isEstimated: Boolean,
    val tariff: String?,
    val total: Double,
    val creditApplied: Double,
)

data class UtilityStatement(
    val id: String,
    val propertyName: String?,
    val unitLabel: String?,
    val periodStart: String,
    val periodEnd: String,
    val total: Double,
    val vat: Double?,
    val lines: List<UtilityStatementLine>,
    val notes: List<String>,
)

sealed interface UtilityStatementsResult {
    data class Loaded(val statements: List<UtilityStatement>) : UtilityStatementsResult
    data class Error(val message: String) : UtilityStatementsResult
}

interface UtilityStatementsRepository {
    suspend fun getMyStatements(): UtilityStatementsResult
}
