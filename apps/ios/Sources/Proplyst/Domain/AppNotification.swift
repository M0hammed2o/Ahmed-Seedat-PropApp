import Foundation

/// Mirrors `apps/android`'s `AppNotification` domain model and the `notifications` table
/// (migration `20260101000039`). In-app notification centre only -- OS push (APNs) is a separate,
/// genuinely external undertaking (needs an Apple Developer account + push certificate/key),
/// documented in `NATIVE_IOS_SPEC.md` §11, not built here.
struct AppNotification: Identifiable, Codable, Equatable, Sendable {
    let id: String
    let type: String
    let title: String
    let body: String?
    let relatedEntityType: String?
    let relatedEntityId: String?
    let readAt: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case title
        case body
        case relatedEntityType = "related_entity_type"
        case relatedEntityId = "related_entity_id"
        case readAt = "read_at"
        case createdAt = "created_at"
    }
}

/// Mirrors the `announcements` table -- notices/announcements, shared between Owner and Tenant
/// portals (same RLS-scoped read every existing native repository pattern uses).
struct Announcement: Identifiable, Codable, Equatable, Sendable {
    let id: String
    let orgId: String
    let title: String
    let body: String
    let requiresAcknowledgement: Bool
    let readAt: String?
    let acknowledgedAt: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case orgId = "org_id"
        case title
        case body
        case requiresAcknowledgement = "requires_acknowledgement"
        case readAt = "read_at"
        case acknowledgedAt = "acknowledged_at"
        case createdAt = "created_at"
    }
}
