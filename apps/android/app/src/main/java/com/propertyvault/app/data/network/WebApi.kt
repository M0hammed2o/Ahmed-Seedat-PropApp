package com.propertyvault.app.data.network

import com.propertyvault.app.data.network.dto.PaymentReportCreateResponse
import com.propertyvault.app.data.network.dto.PaymentReportListResponse
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part

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
}
