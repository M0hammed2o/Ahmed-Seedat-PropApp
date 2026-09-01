import Foundation

/// Mirrors `packages/types/src/paymentReports.ts`'s `PaymentReport` interface and `apps/android`'s
/// `PaymentReport` domain model EXACTLY -- see `NATIVE_IOS_SPEC.md` §16.1 for why this (the
/// tenant-reported-payment-claim workflow), not a full invoice/balance ledger view, is iOS V1's
/// correct payments target: it matches what Android actually shipped, not this document's own
/// more ambitious original vision. A CLAIM, never the ledger itself -- reviewed/confirmed by
/// staff/owner server-side (`confirm_payment_report()`), never something this app marks confirmed
/// on-device. `tenantName`/`propertyName`/`documentId` are populated for the owner/staff review
/// screen, `nil` for a tenant's own view of their own reports.
struct PaymentReport: Identifiable, Codable, Equatable, Sendable {
    let id: String
    let amount: Double
    let paymentMethod: String
    let paymentDate: String
    let status: String
    let rejectionReason: String?
    let createdAt: String
    let tenantName: String?
    let propertyName: String?
    let documentId: String?

    enum CodingKeys: String, CodingKey {
        case id
        case amount
        case paymentMethod = "payment_method"
        case paymentDate = "payment_date"
        case status
        case rejectionReason = "rejection_reason"
        case createdAt = "created_at"
        case tenantName = "tenant_name"
        case propertyName = "property_name"
        case documentId = "document_id"
    }
}

/// Input for submitting a new payment report -- mirrors Android's `ReportPaymentInput`.
/// `proofFileURL` is a local file URL (the picked/captured photo or PDF), converted to a
/// multipart part by the repository implementation, never uploaded from the domain layer itself.
struct ReportPaymentInput: Sendable {
    let amount: Double
    let paymentMethod: String
    let paymentDate: String
    let proofFileURL: URL?
}
