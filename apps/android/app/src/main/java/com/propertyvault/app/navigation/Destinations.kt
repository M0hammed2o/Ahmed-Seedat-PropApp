package com.propertyvault.app.navigation

// Route constants -- Navigation Compose (NATIVE_ANDROID_SPEC.md §2). Owner-portal bottom-nav
// destinations only for this first vertical slice; Tenant portal and the remaining owner tabs
// (Operations/Finance/More) follow once their own modules are built (TASKS.md M20/M22).
object Destinations {
    const val SPLASH = "splash"
    const val SIGN_IN = "sign_in"

    const val OWNER_ROOT = "owner_root"
    const val DASHBOARD = "dashboard"
    const val PROPERTIES_LIST = "properties"
    const val PROPERTY_DETAIL = "properties/{propertyId}"
    const val UNITS_LIST = "properties/{propertyId}/units"
    const val UNIT_DETAIL = "properties/{propertyId}/units/{unitId}"

    fun propertyDetail(propertyId: String) = "properties/$propertyId"
    fun unitsList(propertyId: String) = "properties/$propertyId/units"
    fun unitDetail(propertyId: String, unitId: String) = "properties/$propertyId/units/$unitId"
}
