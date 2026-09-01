import Foundation

/// Path constants for the `apps/admin` Next.js API surface this app consumes -- mirrors
/// `apps/android`'s `WebApi.kt`/`PostgrestApi.kt` Retrofit interfaces conceptually (Swift has no
/// direct Retrofit equivalent; a real implementation builds `URLRequest`s from these paths via
/// `APIClient.send(path:...)`). `API_SPEC.md` §0's rule holds here too: no mobile-only endpoints
/// -- every path below is one the web app itself calls, never invented for this app alone.
enum WebAPIEndpoints {
    // MARK: Auth (direct to Supabase Auth, not the Next.js API -- see APIClient.performRefresh())
    static let supabaseSignInWithPassword = "/auth/v1/token?grant_type=password"
    static let supabaseSignOut = "/auth/v1/logout"

    // MARK: Tenant portal -- payment reporting (NATIVE_IOS_SPEC.md §16.1 V1 scope)
    static let myPaymentReports = "/api/v1/payment-reports"
    static let reportPayment = "/api/v1/tenant-portal/payment-reports"
    static func confirmPaymentReport(id: String) -> String { "/api/v1/payment-reports/\(id)/confirm" }
    static func rejectPaymentReport(id: String) -> String { "/api/v1/payment-reports/\(id)/reject" }

    // MARK: Maintenance
    static let maintenanceTickets = "/api/v1/maintenance-tickets"
    static func maintenanceTicket(id: String) -> String { "/api/v1/maintenance-tickets/\(id)" }
    static func maintenanceTicketDocuments(ticketId: String) -> String {
        "/api/v1/tenant-portal/maintenance-tickets/\(ticketId)/documents"
    }

    // MARK: Documents (signed-URL open, shared across every attachment/proof flow)
    static func document(id: String) -> String { "/api/v1/documents/\(id)" }

    // MARK: Notifications
    static let notifications = "/api/v1/notifications"
    static func markNotificationRead(id: String) -> String { "/api/v1/notifications/\(id)/read" }

    // MARK: Announcements
    static let announcements = "/api/v1/announcements"
    static func acknowledgeAnnouncement(id: String) -> String { "/api/v1/announcements/\(id)/acknowledge" }

    // MARK: Owner/staff (PostgREST-direct reads, per API_SPEC.md §0's own carve-out --
    // apps/android's PostgrestApi.kt reads organization_members/tenants the same way)
    static let myOrganizationMemberships = "/rest/v1/organization_members"
    static let myTenancies = "/rest/v1/tenants"
}
