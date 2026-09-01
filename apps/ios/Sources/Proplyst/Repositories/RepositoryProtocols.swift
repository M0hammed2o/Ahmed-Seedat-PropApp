import Foundation

/// Repository protocols only -- real `APIClient`-backed implementations are Xcode-verification
/// work, deliberately not attempted blind (see this directory's own README). Every method's
/// shape mirrors the equivalent `apps/android` repository interface exactly (same operations, same
/// "the server decides success/failure, this app never re-implements business logic" posture --
/// `NATIVE_IOS_SPEC.md` §7's explicit "no client-side business logic duplication" rule).
///
/// Every `Result` error case is `APIError` (never a raw `Error`/`String`) so every call site gets
/// `.userMessage` for free -- see `APIError.swift`.

protocol PropertiesRepository: Actor {
    func getProperties() async -> Result<[Property], APIError>
    func getProperty(id: String) async -> Result<Property, APIError>
}

protocol UnitsRepository: Actor {
    func getUnits(propertyId: String) async -> Result<[PropertyUnit], APIError>
    func getUnit(propertyId: String, unitId: String) async -> Result<PropertyUnit, APIError>
}

protocol TenantsRepository: Actor {
    func getTenants() async -> Result<[Tenant], APIError>
    func getTenant(id: String) async -> Result<Tenant, APIError>
}

protocol LeasesRepository: Actor {
    func getLeases(unitId: String) async -> Result<[Lease], APIError>
}

protocol MaintenanceRepository: Actor {
    func getTickets() async -> Result<[MaintenanceTicket], APIError>
    func getTicket(id: String) async -> Result<MaintenanceTicket, APIError>
    /// Tenant-portal ticket submission -- mirrors `apps/android`'s
    /// `CreateMaintenanceTicketRequest`/`createTicket()`.
    func createTicket(summary: String, description: String?, priority: String) async -> Result<MaintenanceTicket, APIError>
    func getAttachments(ticketId: String) async -> Result<[MaintenanceAttachment], APIError>
    /// `fileURL` is a local file URL (camera capture or photo/document picker) -- the
    /// implementation converts it to a multipart upload. A failure here, including the
    /// malware-scan fail-closed 503 (`NATIVE_IOS_SPEC.md` §16.2), surfaces via
    /// `APIError.server(_, message:)` carrying the server's own exact wording -- callers render
    /// `.userMessage` directly, never invent their own copy for this case.
    func uploadAttachment(ticketId: String, fileURL: URL, mimeType: String) async -> Result<MaintenanceAttachment, APIError>
    func getAttachmentURL(documentId: String) async -> Result<URL, APIError>
}

protocol PaymentReportsRepository: Actor {
    /// Scope note (`NATIVE_IOS_SPEC.md` §16.1): this is the tenant-reported-payment-claim
    /// workflow, matching Android's actual V1 shipped scope -- NOT a full invoice/balance ledger
    /// view (no `getInvoices()`/`getBalance()` method exists here on purpose; that is a real,
    /// currently-missing gap on both native platforms, tracked as a shared follow-up, not solved
    /// independently for iOS alone).
    func getMyPaymentReports() async -> Result<[PaymentReport], APIError>
    func reportPayment(_ input: ReportPaymentInput) async -> Result<PaymentReport, APIError>
    func confirmPaymentReport(id: String) async -> Result<Void, APIError>
    func rejectPaymentReport(id: String, reason: String) async -> Result<Void, APIError>
    func getDocumentURL(documentId: String) async -> Result<URL, APIError>
}

protocol NotificationsRepository: Actor {
    func getMyNotifications() async -> Result<[AppNotification], APIError>
    func markRead(id: String) async -> Result<Void, APIError>
}

protocol AnnouncementsRepository: Actor {
    func getAnnouncements() async -> Result<[Announcement], APIError>
    func acknowledge(id: String) async -> Result<Void, APIError>
}
