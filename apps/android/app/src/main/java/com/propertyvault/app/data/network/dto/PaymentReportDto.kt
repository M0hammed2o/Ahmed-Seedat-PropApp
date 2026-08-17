package com.propertyvault.app.data.network.dto

import kotlinx.serialization.Serializable

// Wire shape for the Next.js web API's payment-reports endpoints (NOT PostgREST -- these hit
// API_BASE_URL, `Content-Type: application/json`, already camelCase per mapPaymentReportRow()
// (apps/admin/lib/paymentReports.ts), unlike PostgrestApi's DTOs, which are snake_case straight
// off Postgres columns). Android V1 commercial-launch pass (WORKLOG.md this date).

@Serializable
data class PaymentReportDto(
    val id: String,
    val orgId: String,
    val propertyId: String,
    val leaseId: String,
    val rentScheduleId: String? = null,
    val tenantId: String,
    val reportedByTenant: Boolean,
    val reportedByUserId: String,
    val amount: Double,
    val paymentMethod: String,
    val paymentDate: String,
    val documentId: String? = null,
    val status: String,
    val reviewedBy: String? = null,
    val reviewedAt: String? = null,
    val rejectionReason: String? = null,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class PaymentReportListResponse(val paymentReports: List<PaymentReportDto>)

@Serializable
data class PaymentReportCreateResponse(val paymentReport: PaymentReportDto)

@Serializable
data class WebApiErrorBody(val error: WebApiErrorDetail? = null)

@Serializable
data class WebApiErrorDetail(val code: String? = null, val message: String? = null)
