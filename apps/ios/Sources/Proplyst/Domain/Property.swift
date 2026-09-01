import Foundation

/// Mirrors `packages/types/src/property.ts`'s `Property` interface and
/// `apps/android`'s `Property` domain model field-for-field.
struct Property: Identifiable, Codable, Equatable, Sendable {
    let id: String
    let orgId: String
    let nickname: String
    let fullAddress: String
    let city: String
    let province: String?
    let propertyType: String
    let municipalAccountNumber: String?
    let notes: String?
    let status: String

    enum CodingKeys: String, CodingKey {
        case id
        case orgId = "org_id"
        case nickname
        case fullAddress = "full_address"
        case city
        case province
        case propertyType = "property_type"
        case municipalAccountNumber = "municipal_account_number"
        case notes
        case status
    }
}
