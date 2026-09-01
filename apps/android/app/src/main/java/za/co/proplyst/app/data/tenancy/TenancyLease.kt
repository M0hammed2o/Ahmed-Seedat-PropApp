package za.co.proplyst.app.data.tenancy

/** "My Lease" (Invoice V1 completion pass, WORKLOG.md this date) -- answers "what property/unit
 * am I renting, what is my lease status" for the tenant portal, a real, previously-missing V1
 * gap (the tenant portal had zero lease-related screens at all before this pass). Mirrors
 * `resolveTenantSession()`'s own shape (apps/admin/lib/tenantSession.ts) conceptually, scoped
 * down to what a single "current tenancy" view needs. */
data class TenancyLease(
    val tenantId: String,
    val orgId: String,
    val propertyNickname: String?,
    val propertyAddress: String?,
    val unitLabel: String?,
    val leaseStatus: String?,
    val startDate: String?,
    val endDate: String?,
    val rentAmount: Double?,
)

sealed interface TenancyLeaseResult {
    data class Loaded(val lease: TenancyLease) : TenancyLeaseResult
    data object NoTenancy : TenancyLeaseResult
    data class Error(val message: String) : TenancyLeaseResult
}

/** One real implementation (PostgrestTenancyRepository) and one mock, never mixed -- the same
 * split every other repository in this app already uses. Multiple tenancies (Phase 5 audit,
 * WORKLOG.md this date): the backend's own RLS (`caller_tenant_ids()`) returns every tenancy a
 * caller holds blended together with no per-request "active tenancy" scoping mechanism at the
 * API layer -- a real switcher would need that added server-side first (new API surface, not
 * "expose already-computed truth"), so this V1 pass shows the caller's most likely-current
 * tenancy (an active lease, else the most recently created) rather than build a partial,
 * half-working switcher. Disclosed as a real, reasoned scope decision -- see this pass's own
 * final report. */
interface TenancyRepository {
    suspend fun getMyLease(): TenancyLeaseResult
}
