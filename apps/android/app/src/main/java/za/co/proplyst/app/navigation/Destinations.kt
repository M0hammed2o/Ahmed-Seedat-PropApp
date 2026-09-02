package za.co.proplyst.app.navigation

// Route constants -- Navigation Compose (NATIVE_ANDROID_SPEC.md §2). Owner-portal bottom-nav
// destinations only for this first vertical slice; Tenant portal and the remaining owner tabs
// (Operations/Finance/More) follow once their own modules are built (TASKS.md M20/M22).
object Destinations {
    const val SPLASH = "splash"
    const val SIGN_IN = "sign_in"
    // One-time biometric offer after the first successful sign-in (fidelity audit §6) -- shown
    // between SPLASH's role resolution and the portal, only when hardware is available, the lock
    // is off, and the offer has never been shown on this install.
    const val BIO_OFFER = "bio_offer"

    const val OWNER_ROOT = "owner_root"

    // Proplyst Mobile Design System redesign pass -- owner IA collapsed to 4 primary destinations
    // (Home/Properties/Activity/More) per the approved Navy Deck direction; every screen that used
    // to be its own top-level tab (Tenants, Invoices, Payments, Maintenance, Summary, Alerts) is
    // still reachable, just nested under Properties/Activity/More instead of the bottom nav.
    // DASHBOARD below IS the Home tab's route (kept as-is, not renamed, so the existing App Links
    // deep-link contract in AppLinkParser.kt and its tests stay correct).
    const val DASHBOARD = "dashboard"
    const val OWNER_ACTIVITY = "owner_activity"
    const val OWNER_MORE = "owner_more"
    const val APPEARANCE_SETTINGS = "appearance"

    const val PROPERTIES_LIST = "properties"
    const val PROPERTY_DETAIL = "properties/{propertyId}"
    const val UNITS_LIST = "properties/{propertyId}/units"
    const val UNIT_DETAIL = "properties/{propertyId}/units/{unitId}"
    const val TENANTS_LIST = "tenants"
    const val TENANT_DETAIL = "tenants/{tenantId}"
    const val LEASES_LIST = "properties/{propertyId}/units/{unitId}/leases"
    const val LEASE_DETAIL = "properties/{propertyId}/units/{unitId}/leases/{leaseId}"

    fun propertyDetail(propertyId: String) = "properties/$propertyId"
    fun unitsList(propertyId: String) = "properties/$propertyId/units"
    fun unitDetail(propertyId: String, unitId: String) = "properties/$propertyId/units/$unitId"
    fun tenantDetail(tenantId: String) = "tenants/$tenantId"
    fun leasesList(propertyId: String, unitId: String) = "properties/$propertyId/units/$unitId/leases"
    fun leaseDetail(propertyId: String, unitId: String, leaseId: String) =
        "properties/$propertyId/units/$unitId/leases/$leaseId"

    const val MAINTENANCE_LIST = "maintenance"
    const val MAINTENANCE_DETAIL = "maintenance/{ticketId}"

    fun maintenanceDetail(ticketId: String) = "maintenance/$ticketId"

    // Tenant ticket submission (Android V1 final gap-closure pass, WORKLOG.md this date, Phase 4).
    // MAINTENANCE_LIST/MAINTENANCE_DETAIL above are reused as-is for the tenant portal's own
    // nested NavHost -- same "shared route names, separate NavControllers" pattern as
    // NOTIFICATIONS_LIST below.
    const val CREATE_MAINTENANCE_TICKET = "maintenance/create"

    // Tenant documents (same pass, Phase 5).
    const val DOCUMENTS_LIST = "documents"

    // Tenant notices/announcements (same pass, Phase 6).
    const val ANNOUNCEMENTS_LIST = "announcements"

    // Owner/staff payment review (Android V1 final gap-closure pass, WORKLOG.md this date,
    // Phase 3).
    const val PAYMENT_REVIEW_LIST = "payment_review"

    // Owner monthly property summary (same pass, Phase 8).
    const val OWNER_SUMMARY_LIST = "owner_summary"

    // V1 utilities/rates/levies/budgets pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6) -- paid/
    // unpaid rent status per property+month, server-authoritative from rent_schedules.
    const val RENT_STATUS_LIST = "rent_status"

    // Continuation pass -- owner expense/utility/budget mobile workflows (§9).
    const val ADD_EXPENSE = "add_expense"
    const val UTILITY_CAPTURE = "utility_capture"
    const val UTILITY_HISTORY = "utility_history"
    const val BUDGET_VIEW = "budget_view"

    // In-app notifications + settings (same pass, Phase 7/9) -- shared route names across both
    // the Owner and Tenant nested NavHosts (each has its own NavController, so no collision).
    const val NOTIFICATIONS_LIST = "notifications"
    const val NOTIFICATION_SETTINGS = "notifications/settings"

    // Account/sign-out (auth/session hardening pass, WORKLOG.md this date) -- shared route name
    // across both the Owner and Tenant nested NavHosts, same pattern as NOTIFICATIONS_LIST.
    const val ACCOUNT = "account"

    // Tenant portal (Android V1 commercial-launch pass, WORKLOG.md this date, Phase 4) -- payment
    // reporting only in this first slice; tenant Maintenance/Documents/Notices follow once their
    // own modules are built (see the same pass's final report for the disclosed remaining gaps).
    const val TENANT_ROOT = "tenant_root"
    const val PAYMENTS_LIST = "payments"
    const val REPORT_PAYMENT = "payments/report"

    // Proplyst Mobile Design System redesign pass -- tenant IA collapsed to 4 primary destinations
    // (Home/Payments/Requests/Profile). TENANT_HOME is new; PAYMENTS_LIST/MAINTENANCE_LIST/ACCOUNT
    // above are reused as the content behind Payments/Requests/Profile respectively, restyled, not
    // duplicated.
    const val TENANT_HOME = "tenant_home"
    const val TENANT_PROFILE = "tenant_profile"

    // Invoice V1 completion pass (WORKLOG.md this date) -- the authoritative invoice/balance
    // ledger, distinct from PAYMENTS_LIST above (the tenant-REPORTED payment-CLAIM workflow).
    // Shared route names across both the Owner and Tenant nested NavHosts, same pattern as
    // NOTIFICATIONS_LIST.
    const val INVOICES_LIST = "invoices"
    const val INVOICE_DETAIL = "invoices/{invoiceId}"
    const val RECORD_PAYMENT = "invoices/{invoiceId}/record-payment"

    fun invoiceDetail(invoiceId: String) = "invoices/$invoiceId"
    fun recordPayment(invoiceId: String) = "invoices/$invoiceId/record-payment"

    // "My Lease" (Invoice V1 completion pass, WORKLOG.md this date) -- tenant-only, reached from
    // AccountScreen (never a bottom-nav tab -- the Tenant NavHost already carries 6 tabs after
    // adding Invoices; see OwnerRootScreen.kt's own disclosed tab-count P2 note).
    const val MY_LEASE = "my_lease"
}
