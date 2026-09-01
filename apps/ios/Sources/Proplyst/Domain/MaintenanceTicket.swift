import Foundation

/// Mirrors `apps/android`'s `MaintenanceTicket` domain model -- a deliberate subset of
/// `packages/types/src/operations.ts`'s `MaintenanceTicket` interface (unitId/leaseId/tenantId/
/// submittedBy*/assignedVendorId/resolvedAt omitted, no view-only-screen use yet).
struct MaintenanceTicket: Identifiable, Codable, Equatable, Sendable {
    let id: String
    let orgId: String
    let propertyId: String
    let summary: String
    let description: String?
    let priority: String
    let status: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case orgId = "org_id"
        case propertyId = "property_id"
        case summary
        case description
        case priority
        case status
        case createdAt = "created_at"
    }
}

/// A maintenance-ticket attachment (photo/document) -- mirrors `apps/android`'s `TenantDocument`
/// used for the same purpose, and the shared `documents` table row shape.
struct MaintenanceAttachment: Identifiable, Codable, Equatable, Sendable {
    let id: String
    let originalFileName: String
    let mimeType: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case originalFileName = "original_file_name"
        case mimeType = "mime_type"
        case createdAt = "created_at"
    }
}
