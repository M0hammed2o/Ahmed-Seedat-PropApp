package com.propertyvault.app.data.network

import com.propertyvault.app.data.network.dto.LeaseDto
import com.propertyvault.app.data.network.dto.MaintenanceTicketDto
import com.propertyvault.app.data.network.dto.OrganizationMemberDto
import com.propertyvault.app.data.network.dto.TenancyMembershipDto
import com.propertyvault.app.data.network.dto.PropertyDto
import com.propertyvault.app.data.network.dto.TenantDto
import com.propertyvault.app.data.network.dto.UnitDto
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Query

/**
 * Direct PostgREST reads (BuildConfig.SUPABASE_URL/rest/v1/...) -- API_SPEC.md §0's explicit
 * carve-out: "no client bypassing business logic to write Postgres directly except for plain
 * RLS-protected reads where no server-side rule applies." Every query here is a read RLS already
 * scopes to the caller's own session (the same `organization_members`/`properties` policies
 * apps/admin's own direct-Supabase reads rely on) -- the `Authorization: Bearer <jwt>` header
 * (added by NetworkModule's auth interceptor) is what makes RLS apply per-caller rather than as
 * the anon role.
 */
interface PostgrestApi {
    @GET("rest/v1/organization_members")
    suspend fun getMyOrganizationMemberships(
        @Query("select") select: String = "org_id,role,status",
        @Query("user_id") userIdFilter: String,
    ): Response<List<OrganizationMemberDto>>

    /** Android V1 commercial-launch pass: role-routing at sign-in/session-restore (owner/staff vs
     * tenant). `tenants_select_org_or_self` RLS (migration 20260101000028 -- the same policy
     * resolveTenantSession() on the web relies on) scopes this to the caller's own tenancy rows
     * (`user_id = auth.uid()`) -- never another tenant's. */
    @GET("rest/v1/tenants")
    suspend fun getMyTenancies(
        @Query("select") select: String = "id,org_id,status",
        @Query("user_id") userIdFilter: String,
    ): Response<List<TenancyMembershipDto>>

    @GET("rest/v1/properties")
    suspend fun getProperties(
        @Query("select") select: String = "*",
        @Query("status") statusFilter: String = "eq.active",
        @Query("order") order: String = "created_at.desc",
    ): Response<List<PropertyDto>>

    @GET("rest/v1/properties")
    suspend fun getPropertyById(
        @Query("select") select: String = "*",
        @Query("id") idFilter: String,
    ): Response<List<PropertyDto>>

    @GET("rest/v1/units")
    suspend fun getUnitsByProperty(
        @Query("select") select: String = "*",
        @Query("property_id") propertyIdFilter: String,
        @Query("order") order: String = "unit_label.asc",
    ): Response<List<UnitDto>>

    @GET("rest/v1/units")
    suspend fun getUnitById(
        @Query("select") select: String = "*",
        @Query("id") idFilter: String,
    ): Response<List<UnitDto>>

    @GET("rest/v1/tenants")
    suspend fun getTenants(
        @Query("select") select: String = "*",
        @Query("order") order: String = "full_name.asc",
    ): Response<List<TenantDto>>

    @GET("rest/v1/tenants")
    suspend fun getTenantById(
        @Query("select") select: String = "*",
        @Query("id") idFilter: String,
    ): Response<List<TenantDto>>

    @GET("rest/v1/leases")
    suspend fun getLeasesByUnit(
        @Query("select") select: String = "*",
        @Query("unit_id") unitIdFilter: String,
        @Query("order") order: String = "start_date.desc",
    ): Response<List<LeaseDto>>

    @GET("rest/v1/leases")
    suspend fun getLeaseById(
        @Query("select") select: String = "*",
        @Query("id") idFilter: String,
    ): Response<List<LeaseDto>>

    @GET("rest/v1/maintenance_tickets")
    suspend fun getMaintenanceTickets(
        @Query("select") select: String = "*",
        @Query("order") order: String = "created_at.desc",
    ): Response<List<MaintenanceTicketDto>>

    @GET("rest/v1/maintenance_tickets")
    suspend fun getMaintenanceTicketById(
        @Query("select") select: String = "*",
        @Query("id") idFilter: String,
    ): Response<List<MaintenanceTicketDto>>
}
