package za.co.proplyst.app.data.network

import za.co.proplyst.app.data.network.dto.AnnouncementListResponse
import za.co.proplyst.app.data.network.dto.CreateTenantMaintenanceTicketRequest
import za.co.proplyst.app.data.network.dto.DocumentDetailResponse
import za.co.proplyst.app.data.network.dto.DocumentListResponse
import za.co.proplyst.app.data.network.dto.MaintenanceTicketCreateResponse
import za.co.proplyst.app.data.network.dto.PaymentReportCreateResponse
import za.co.proplyst.app.data.network.dto.PaymentReportListResponse
import za.co.proplyst.app.data.network.dto.RejectPaymentReportRequest
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path

/**
 * Calls into the Next.js web API (`BuildConfig.API_BASE_URL`), never Supabase directly -- for
 * endpoints that carry real server-side business logic (API_SPEC.md §0: storage upload +
 * malware scan + owner-notification dispatch on report, RLS + confirm/reject RPC gating on
 * review) that a plain RLS-scoped PostgREST insert cannot replicate without duplicating that
 * logic on-device. `getServerSupabaseClient()` (apps/admin/lib/supabase/server.ts) already
 * explicitly supports this exact call shape -- `Authorization: Bearer <supabase-access-token>`,
 * no cookie -- so no new backend auth path was needed, only these Android-side call sites
 * (Android V1 commercial-launch pass, WORKLOG.md this date).
 */
interface WebApi {
    /** The caller's own payment reports -- RLS (`payment_reports_select_tenant_self`) is the
     * real scope; this endpoint is shared with the staff/owner review UI but returns only what
     * the caller's own session is allowed to see either way. */
    @GET("api/v1/payment-reports")
    suspend fun getMyPaymentReports(): Response<PaymentReportListResponse>

    @Multipart
    @POST("api/v1/tenant-portal/payment-reports")
    suspend fun reportPayment(
        @Part("amount") amount: RequestBody,
        @Part("paymentMethod") paymentMethod: RequestBody,
        @Part("paymentDate") paymentDate: RequestBody,
        @Part proof: MultipartBody.Part?,
    ): Response<PaymentReportCreateResponse>

    // Owner/staff review (Android V1 final gap-closure pass, Phase 3). Both RPC-backed
    // (confirm_payment_report()/reject_payment_report()) -- role/property/org permission
    // enforcement happens server-side via RLS on the SAME endpoint the web review UI calls; this
    // app never re-implements that check.
    @POST("api/v1/payment-reports/{id}/confirm")
    suspend fun confirmPaymentReport(@Path("id") id: String): Response<Unit>

    @POST("api/v1/payment-reports/{id}/reject")
    suspend fun rejectPaymentReport(
        @Path("id") id: String,
        @Body body: RejectPaymentReportRequest,
    ): Response<Unit>

    /** Signed, short-lived document URL (Phase 3 "open proof securely" / Phase 5 tenant
     * documents) -- the bucket is private; RLS on `documents` is the only real access check,
     * shared with the web app's own /api/v1/documents/:id route. */
    @GET("api/v1/documents/{id}")
    suspend fun getDocument(@Path("id") id: String): Response<DocumentDetailResponse>

    /** The caller's own tenancy documents (Phase 5) -- RLS (`documents_select_tenant_self`)
     * scopes this to only documents explicitly tagged with the caller's own lease_id; no
     * filter[property_id] sent, same as every other "my own" endpoint in this file. */
    @GET("api/v1/documents")
    suspend fun getMyDocuments(): Response<DocumentListResponse>

    /** Tenant-submitted maintenance ticket (Phase 4). org/property/unit/lease/tenant context is
     * derived server-side from the caller's own active lease -- this app never sends it. */
    @POST("api/v1/tenant-portal/maintenance-tickets")
    suspend fun createTenantMaintenanceTicket(
        @Body body: CreateTenantMaintenanceTicketRequest,
    ): Response<MaintenanceTicketCreateResponse>

    /** The caller's own visible announcements (Phase 6) -- RLS
     * (`announcements_select_org_or_tenant`) is the real scope. */
    @GET("api/v1/announcements")
    suspend fun getMyAnnouncements(): Response<AnnouncementListResponse>

    /** Resolves the caller's own tenant identity server-side and upserts their own
     * announcement_reads row -- never a client-supplied tenant_id. */
    @POST("api/v1/announcements/{id}/acknowledge")
    suspend fun acknowledgeAnnouncement(@Path("id") id: String): Response<Unit>
}
