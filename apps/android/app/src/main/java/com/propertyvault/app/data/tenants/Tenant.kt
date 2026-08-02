package com.propertyvault.app.data.tenants

// Domain model -- mirrors packages/types/src/leasing.ts's Tenant interface, minus idNumberRef
// (a pointer into encrypted_secrets with no view-only-screen use yet, deliberately left out
// rather than plumbed through with nothing to show for it).
data class Tenant(
    val id: String,
    val orgId: String,
    val fullName: String,
    val email: String?,
    val phone: String?,
    val status: String,
)
