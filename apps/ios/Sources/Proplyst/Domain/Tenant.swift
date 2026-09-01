import Foundation

/// Mirrors `packages/types/src/leasing.ts`'s `Tenant` interface and `apps/android`'s `Tenant`
/// domain model. `idNumberRef` deliberately omitted -- a pointer into `encrypted_secrets` with no
/// view-only-screen use yet, same reasoning Android's own model documents.
struct Tenant: Identifiable, Codable, Equatable, Sendable {
    let id: String
    let orgId: String
    let fullName: String
    let email: String?
    let phone: String?
    let status: String

    enum CodingKeys: String, CodingKey {
        case id
        case orgId = "org_id"
        case fullName = "full_name"
        case email
        case phone
        case status
    }
}
