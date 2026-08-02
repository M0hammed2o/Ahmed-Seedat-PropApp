package com.propertyvault.app.data.maintenance

// Domain model -- a deliberate subset of packages/types/src/operations.ts's MaintenanceTicket
// interface for this view-only V1 slice (unitId/leaseId/tenantId/submittedBy*/assignedVendorId/
// resolvedAt omitted, no view-only-screen use yet). See WORKLOG.md/DECISIONS.md 2026-08-01 for why
// ticket *submission* isn't built yet even though MOBILE_ARCHITECTURE_DECISION.md §6/§7 calls
// Maintenance out as the native-app write-path priority: it needs the admin API's Bearer-JWT auth
// path (API_SPEC.md §0), which apps/admin's own route handlers don't implement yet (they're
// cookie-session-only) -- a real, separately-scoped gap, not something to route around here.
data class MaintenanceTicket(
    val id: String,
    val orgId: String,
    val propertyId: String,
    val summary: String,
    val description: String?,
    val priority: String,
    val status: String,
    val createdAt: String,
)
