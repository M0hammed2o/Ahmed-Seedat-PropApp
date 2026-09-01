import Foundation

/// Mirrors `packages/types/src/leasing.ts`'s `Lease` interface and `apps/android`'s `Lease`
/// domain model. `source`/`sourceDocumentId`/`sourceApplicationId` deliberately omitted --
/// internal provenance fields with no view-only-screen use yet, same reasoning Android's own
/// model documents.
struct Lease: Identifiable, Codable, Equatable, Sendable {
    let id: String
    let orgId: String
    let unitId: String
    let startDate: String
    let endDate: String?
    let rentAmount: Double
    let rentFrequency: String
    let depositAmount: Double
    let status: String

    enum CodingKeys: String, CodingKey {
        case id
        case orgId = "org_id"
        case unitId = "unit_id"
        case startDate = "start_date"
        case endDate = "end_date"
        case rentAmount = "rent_amount"
        case rentFrequency = "rent_frequency"
        case depositAmount = "deposit_amount"
        case status
    }
}
