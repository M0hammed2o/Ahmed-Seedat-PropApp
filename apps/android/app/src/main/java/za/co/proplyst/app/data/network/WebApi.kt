package za.co.proplyst.app.data.network

import za.co.proplyst.app.data.network.dto.AnnouncementListResponse
import za.co.proplyst.app.data.network.dto.CreateTenantMaintenanceTicketRequest
import za.co.proplyst.app.data.network.dto.DocumentDetailResponse
import za.co.proplyst.app.data.network.dto.DocumentCategoryListResponse
import za.co.proplyst.app.data.network.dto.DocumentListResponse
import za.co.proplyst.app.data.network.dto.DocumentUploadResponseDto
import za.co.proplyst.app.data.network.dto.ExpenseCreateRequest
import za.co.proplyst.app.data.network.dto.ExpenseCreateResponse
import za.co.proplyst.app.data.network.dto.FinancialSummaryResponse
import za.co.proplyst.app.data.network.dto.UtilityHistoryResponse
import za.co.proplyst.app.data.network.dto.UtilityMeterCreateRequest
import za.co.proplyst.app.data.network.dto.UtilityMeterCreateResponse
import za.co.proplyst.app.data.network.dto.UtilityMeterListResponse
import za.co.proplyst.app.data.network.dto.UtilityReadingCreateRequest
import za.co.proplyst.app.data.network.dto.TenantPaymentStatusResponse
import za.co.proplyst.app.data.network.dto.InsightListResponse
import za.co.proplyst.app.data.network.dto.InvoiceDetailResponse
import za.co.proplyst.app.data.network.dto.InvoiceListResponse
import za.co.proplyst.app.data.network.dto.InvoicePaymentCreateResponse
import za.co.proplyst.app.data.network.dto.InvoicePaymentListResponse
import za.co.proplyst.app.data.network.dto.MaintenanceDocumentUploadResponse
import za.co.proplyst.app.data.network.dto.MaintenanceTicketCreateResponse
import za.co.proplyst.app.data.network.dto.PaymentReportCreateResponse
import za.co.proplyst.app.data.network.dto.PaymentReportListResponse
import za.co.proplyst.app.data.network.dto.PropertyCardExtrasDetailResponse
import za.co.proplyst.app.data.network.dto.PropertyCardExtrasListResponse
import za.co.proplyst.app.data.network.dto.RecordInvoicePaymentRequest
import za.co.proplyst.app.data.network.dto.RejectPaymentReportRequest
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

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

    /** Attach a photo/file to the caller's OWN maintenance ticket (Android V1 last local blocker
     * pass, WORKLOG.md this date). The route derives org/property/tenant context from the ticket
     * itself, server-side, after proving ownership via the caller's own session-bound client --
     * this app never sends anything beyond the ticket id in the path and the file. */
    @Multipart
    @POST("api/v1/tenant-portal/maintenance-tickets/{id}/documents")
    suspend fun uploadMaintenanceTicketDocument(
        @Path("id") ticketId: String,
        @Part file: MultipartBody.Part,
    ): Response<MaintenanceDocumentUploadResponse>

    /** A maintenance ticket's attached documents -- RLS scopes this exactly like every other
     * `documents` read (tenant: only their own lease-tagged rows; staff: org/property access) --
     * shared by the tenant attachment viewer and any future staff-side ticket detail screen. */
    @GET("api/v1/documents")
    suspend fun getMaintenanceTicketDocuments(
        @Query("filter[maintenance_ticket_id]") ticketId: String,
    ): Response<DocumentListResponse>

    /** Portfolio Intelligence feed (final pre-UAT engineering pass, WORKLOG.md this date, Part 5)
     * -- the deterministic rules-engine insights (AI_ARCHITECTURE.md §2), never an LLM. Owner/
     * staff-only (portfolio_insights has no tenant-self RLS path); `orgId` is the caller's own
     * OrgMembership.orgId, never client-invented. */
    @GET("api/v1/insights")
    suspend fun getPortfolioInsights(
        @Query("filter[org_id]") orgId: String,
    ): Response<InsightListResponse>

    /** Android V1 completion pass (WORKLOG.md this date) -- the ONE invoice list, shared by both
     * portals. RLS alone decides visibility (`invoices_select_org_member` for staff,
     * `invoices_select_tenant_self` for a tenant, issued-only for the latter since migration
     * 20260101000162) -- no orgId/tenantId sent, same "trust RLS, never send a caller-supplied
     * scope" posture as getMyPaymentReports() above. `paid`/`balance`/`displayStatus` are
     * computed server-side (loadInvoicesWithBalances()); this app never recomputes them. */
    @GET("api/v1/invoices")
    suspend fun getInvoices(): Response<InvoiceListResponse>

    /** A non-existent id, another tenant's invoice, another org's invoice, or (for a tenant
     * caller) a draft invoice all resolve to the identical 404 the web app's own PDF route
     * documents -- RLS hides the row entirely, this app never gets a distinguishing signal
     * either. */
    @GET("api/v1/invoices/{id}")
    suspend fun getInvoice(@Path("id") id: String): Response<InvoiceDetailResponse>

    /** The one payment-recording path for both manual and rent-sourced invoices (unified
     * invoice-payment ledger, migration 20260101000158). RLS/role gating (accountant+ org role,
     * via requireOrgRole() server-side) is the real authorization -- a tenant or an
     * insufficiently-privileged staff caller gets a real 403 from the server, never something
     * this app pre-filters or hides a control for alone (a hidden control is a UX nicety, not
     * the enforcement boundary, matching this codebase's established posture everywhere else). */
    @GET("api/v1/invoices/{id}/payments")
    suspend fun getInvoicePayments(@Path("id") invoiceId: String): Response<InvoicePaymentListResponse>

    @POST("api/v1/invoices/{id}/payments")
    suspend fun recordInvoicePayment(
        @Path("id") invoiceId: String,
        @Body body: RecordInvoicePaymentRequest,
    ): Response<InvoicePaymentCreateResponse>

    /** Raw PDF bytes (`Content-Type: application/pdf`), not JSON -- @Streaming avoids buffering
     * the whole file in memory before the caller can start writing it to a cache file. Same RLS-
     * only authorization as every other invoice route: own issued invoice -> real PDF; another
     * tenant's/another org's/a draft/a nonexistent id -> 404, never a distinguishing signal;
     * unauthenticated -> 401. */
    @Streaming
    @GET("api/v1/invoices/{id}/pdf")
    suspend fun getInvoicePdf(@Path("id") id: String): Response<ResponseBody>

    /** Proplyst Mobile Design System redesign pass -- card-visual extras (signed cover-photo URL,
     * real unit/occupancy counts) for the Properties grid and property detail hero, layered onto
     * the direct-Postgrest property read the rest of [za.co.proplyst.app.data.properties
     * .PostgrestPropertiesRepository] already does. Same RLS-only authorization as every other
     * "my own" read; this call is best-effort in the repository (a failure here degrades to
     * plain cards, never blocks the property list/detail itself). */
    @GET("api/v1/properties")
    suspend fun getPropertyCards(): Response<PropertyCardExtrasListResponse>

    @GET("api/v1/properties/{id}")
    suspend fun getPropertyCard(@Path("id") id: String): Response<PropertyCardExtrasDetailResponse>

    /** V1 utilities/rates/levies pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6/§8/§16) -- the one
     * server-authoritative owner financial dashboard call (rent + expenses + budget + net
     * position), avoiding N+1 on Owner Home. Property-scoped -- see [getPortfolioFinancialSummary]
     * for the portfolio-wide call Owner Home actually uses. */
    @GET("api/v1/properties/{id}/financial-summary")
    suspend fun getFinancialSummary(
        @Path("id") propertyId: String,
        @Query("month") month: String,
    ): Response<FinancialSummaryResponse>

    /** Continuation pass (UTILITIES_RATES_BUDGET_IMPLEMENTATION.md "Portfolio-wide owner financial
     * summary") -- the LIVE, org-wide aggregation Owner Home is built on, replacing the previously
     * separate (and stale-snapshot) owner_property_summaries read for the rent hero figures. */
    @GET("api/v1/organizations/{orgId}/financial-summary")
    suspend fun getPortfolioFinancialSummary(
        @Path("orgId") orgId: String,
        @Query("month") month: String,
    ): Response<FinancialSummaryResponse>

    /** §6 paid/unpaid tenant list -- reuses rent_schedules.status directly, never
     * payment_reports.status. */
    @GET("api/v1/properties/{id}/tenant-payment-status")
    suspend fun getTenantPaymentStatus(
        @Path("id") propertyId: String,
        @Query("month") month: String,
    ): Response<TenantPaymentStatusResponse>

    /** Owner Add Expense (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §5) -- creates ONE authoritative
     * expenses row via the existing, unchanged POST /api/v1/expenses (§20's "no duplicate
     * expense/document monetary records" rule: this app never writes to `documents`/`expenses`
     * any other way). */
    @POST("api/v1/expenses")
    suspend fun createExpense(@Body request: ExpenseCreateRequest): Response<ExpenseCreateResponse>

    /** Resolves a document category slug (e.g. "receipt", "bill") to its id -- required before
     * [uploadDocument], mirroring the web ExpenseForm's own uploadEvidenceDocument() lookup. */
    @GET("api/v1/document-categories")
    suspend fun getDocumentCategories(): Response<DocumentCategoryListResponse>

    /** Generic evidence upload (existing, unchanged route -- malware scan + org/property-access
     * gating happen server-side exactly as they already do for the web app). Used for expense
     * receipts and utility-bill evidence -- never a second, Android-only upload path. */
    @Multipart
    @POST("api/v1/documents")
    suspend fun uploadDocument(
        @Part("orgId") orgId: RequestBody,
        @Part("propertyId") propertyId: RequestBody,
        @Part("categoryId") categoryId: RequestBody,
        @Part("documentType") documentType: RequestBody,
        @Part file: MultipartBody.Part,
    ): Response<DocumentUploadResponseDto>

    /** Utility Capture / Utility History (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6/§7, §9-D/§9-F). */
    @GET("api/v1/properties/{id}/utility-meters")
    suspend fun getUtilityMeters(
        @Path("id") propertyId: String,
        @Query("unitId") unitId: String? = null,
    ): Response<UtilityMeterListResponse>

    @POST("api/v1/properties/{id}/utility-meters")
    suspend fun createUtilityMeter(
        @Path("id") propertyId: String,
        @Body request: UtilityMeterCreateRequest,
    ): Response<UtilityMeterCreateResponse>

    @GET("api/v1/utility-meters/{id}/readings")
    suspend fun getUtilityReadingHistory(@Path("id") meterId: String): Response<UtilityHistoryResponse>

    @POST("api/v1/utility-meters/{id}/readings")
    suspend fun createUtilityReading(
        @Path("id") meterId: String,
        @Body request: UtilityReadingCreateRequest,
    ): Response<Unit>
}
