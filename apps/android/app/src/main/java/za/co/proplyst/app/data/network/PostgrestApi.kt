package za.co.proplyst.app.data.network

import za.co.proplyst.app.data.network.dto.AnnouncementReadDto
import za.co.proplyst.app.data.network.dto.LeaseDto
import za.co.proplyst.app.data.network.dto.MaintenanceTicketDto
import za.co.proplyst.app.data.network.dto.NotificationDto
import za.co.proplyst.app.data.network.dto.NotificationPreferenceDto
import za.co.proplyst.app.data.network.dto.NotificationPreferenceUpsert
import za.co.proplyst.app.data.network.dto.NotificationReadUpdate
import za.co.proplyst.app.data.network.dto.OrganizationMemberDto
import za.co.proplyst.app.data.network.dto.OwnerSummaryDto
import za.co.proplyst.app.data.network.dto.TenancyMembershipDto
import za.co.proplyst.app.data.network.dto.TenancyWithLeaseDto
import za.co.proplyst.app.data.network.dto.PropertyDto
import za.co.proplyst.app.data.network.dto.TenantDto
import za.co.proplyst.app.data.network.dto.UnitDto
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Headers
import retrofit2.http.PATCH
import retrofit2.http.POST
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

    /** "My Lease" (Invoice V1 completion pass, WORKLOG.md this date) -- see
     * TenancyWithLeaseDto's own doc comment for why this is a separate, richer call from
     * getMyTenancies() above. `order`/`limit` are irrelevant to correctness (RLS is the real
     * scope; every returned row is genuinely the caller's own) -- present only so a caller with
     * multiple tenancies gets a stable, most-recently-created-first ordering client-side, same
     * convention as every other multi-row "my own" endpoint in this file. */
    @GET("rest/v1/tenants")
    suspend fun getMyTenanciesWithLease(
        @Query("select") select: String =
            "id,org_id,status,lease_tenants(lease_id,leases(id,status,start_date,end_date,rent_amount,unit_id,units(id,unit_label,property_id,properties(id,nickname,full_address))))",
        @Query("user_id") userIdFilter: String,
    ): Response<List<TenancyWithLeaseDto>>

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

    // Owner monthly property summary (Android V1 final gap-closure pass, Phase 8) -- RLS
    // (owner_property_summaries_select_owner_self, migration 20260101000107) scopes this to the
    // caller's own summaries; the aggregation itself already ran server-side
    // (runOwnerMonthlySummaryJob(), lib/systemJobs.ts), never recomputed here.
    @GET("rest/v1/owner_property_summaries")
    suspend fun getMyOwnerSummaries(
        @Query("select") select: String = "*",
        @Query("order") order: String = "period_start.desc",
    ): Response<List<OwnerSummaryDto>>

    // Announcement read receipts (Android V1 last local blocker pass, WORKLOG.md this date). RLS
    // (announcement_reads_select_org_or_self) scopes this to the caller's own rows with no
    // filter needed -- see Announcement.kt's doc comment.
    @GET("rest/v1/announcement_reads")
    suspend fun getMyAnnouncementReads(
        @Query("select") select: String = "announcement_id,read_at,acknowledged_at",
    ): Response<List<AnnouncementReadDto>>

    // In-app notifications (Phase 7). RLS: notifications_select_own/notifications_update_own.
    @GET("rest/v1/notifications")
    suspend fun getMyNotifications(
        @Query("select") select: String = "*",
        @Query("order") order: String = "created_at.desc",
        @Query("limit") limit: Int = 50,
    ): Response<List<NotificationDto>>

    @PATCH("rest/v1/notifications")
    suspend fun markNotificationRead(
        @Query("id") idFilter: String,
        @Body body: NotificationReadUpdate,
    ): Response<Unit>

    // Owner notification settings (Phase 9). RLS: notification_preferences_all_own -- the caller
    // reads/writes their own rows directly, no web-API layer needed (mirrors the web app's own
    // /api/v1/notification-preferences route, which is this same table via the caller's own
    // session-bound client, not a service-role business-logic layer).
    @GET("rest/v1/notification_preferences")
    suspend fun getMyNotificationPreferences(
        @Query("select") select: String = "*",
    ): Response<List<NotificationPreferenceDto>>

    @Headers("Prefer: resolution=merge-duplicates,return=representation")
    @POST("rest/v1/notification_preferences?on_conflict=user_id,category")
    suspend fun upsertNotificationPreference(
        @Body body: NotificationPreferenceUpsert,
    ): Response<List<NotificationPreferenceDto>>
}
