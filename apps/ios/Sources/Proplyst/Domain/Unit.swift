import Foundation

/// Mirrors `apps/android`'s `PropertyUnit` domain model (named to avoid colliding with Swift's
/// own `Unit` type, the same reason Android's own model avoids the bare name `Unit`).
struct PropertyUnit: Identifiable, Codable, Equatable, Sendable {
    let id: String
    let propertyId: String
    let orgId: String
    let unitLabel: String
    let status: String
    let sizeSqm: Double?
    let marketRent: Double?

    enum CodingKeys: String, CodingKey {
        case id
        case propertyId = "property_id"
        case orgId = "org_id"
        case unitLabel = "unit_label"
        case status
        case sizeSqm = "size_sqm"
        case marketRent = "market_rent"
    }
}
