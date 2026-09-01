package za.co.proplyst.app.data.tenancy

import za.co.proplyst.app.data.auth.SessionManager
import za.co.proplyst.app.data.network.PostgrestApi
import za.co.proplyst.app.data.network.dto.TenancyWithLeaseDto
import javax.inject.Inject
import javax.inject.Singleton

/** Real implementation -- Invoice V1 completion pass (WORKLOG.md this date). See
 * PostgrestApi.getMyTenanciesWithLease()'s own doc comment: RLS alone is the real scope, this
 * repository only picks WHICH of the caller's own (already RLS-filtered) tenancies to show by
 * default when there is more than one -- an active lease first, else the most recently started
 * one, mirroring the web app's own `resolveTenantSession()` "prefer active, else most recent"
 * rule (Phase 11) exactly rather than inventing a different tie-break here. */
@Singleton
class PostgrestTenancyRepository @Inject constructor(
    private val api: PostgrestApi,
    private val sessionManager: SessionManager,
) : TenancyRepository {

    override suspend fun getMyLease(): TenancyLeaseResult {
        return try {
            val userId = sessionManager.getUserId() ?: return TenancyLeaseResult.Error("Not signed in.")
            val response = api.getMyTenanciesWithLease(userIdFilter = "eq.$userId")
            if (!response.isSuccessful) {
                return TenancyLeaseResult.Error("Failed to load your lease (${response.code()}).")
            }
            val tenancies = response.body().orEmpty()
            if (tenancies.isEmpty()) return TenancyLeaseResult.NoTenancy

            val active = tenancies.firstOrNull { it.status == "active" && it.hasActiveLease() }
            val mostRecent = tenancies.maxByOrNull { it.leaseStartDate() ?: "" }
            val chosen = active ?: mostRecent ?: tenancies.first()
            TenancyLeaseResult.Loaded(chosen.toDomain())
        } catch (e: Exception) {
            TenancyLeaseResult.Error(e.message ?: "Failed to load your lease — check your connection.")
        }
    }

    private fun TenancyWithLeaseDto.hasActiveLease(): Boolean =
        leaseTenants.any { it.leases?.status == "active" }

    private fun TenancyWithLeaseDto.leaseStartDate(): String? =
        leaseTenants.firstOrNull { it.leases != null }?.leases?.startDate

    private fun TenancyWithLeaseDto.toDomain(): TenancyLease {
        val lease = leaseTenants.firstOrNull { it.leases?.status == "active" }?.leases
            ?: leaseTenants.firstOrNull { it.leases != null }?.leases
        val unit = lease?.units
        val property = unit?.properties
        return TenancyLease(
            tenantId = id,
            orgId = orgId,
            propertyNickname = property?.nickname,
            propertyAddress = property?.fullAddress,
            unitLabel = unit?.unitLabel,
            leaseStatus = lease?.status,
            startDate = lease?.startDate,
            endDate = lease?.endDate,
            rentAmount = lease?.rentAmount,
        )
    }
}
