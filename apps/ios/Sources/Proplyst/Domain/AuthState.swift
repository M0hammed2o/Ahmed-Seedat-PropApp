import Foundation

/// Mirrors `apps/android`'s `OrgMembership` and the web app's `PortalSession` shape
/// (`apps/admin/lib/orgSession.ts`) conceptually.
struct OrgMembership: Codable, Equatable, Sendable {
    let orgId: String
    let role: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case orgId = "org_id"
        case role
        case status
    }
}

/// A tenancy the signed-in user holds (`tenants.user_id = auth.uid()`) -- the tenant-portal
/// equivalent of `OrgMembership`. Mirrors `apps/android`'s `TenancyMembership` exactly:
/// PERMISSIONS.md's "never merge role systems" principle means a user's org-staff identity and
/// tenant identity are resolved and carried completely independently, never folded into one row
/// shape.
struct TenancyMembership: Codable, Equatable, Sendable {
    let tenantId: String
    let orgId: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case tenantId = "tenant_id"
        case orgId = "org_id"
        case status
    }
}

/// Mirrors `apps/android`'s `AuthState` sealed interface as a Swift `enum` with associated
/// values -- the direct Swift-idiomatic equivalent, same three cases, same semantics.
enum AuthState: Equatable, Sendable {
    case loading
    case unauthenticated
    case authenticated(userId: String, organizations: [OrgMembership], tenancies: [TenancyMembership])
}

/// Owner/staff (has an org membership) takes precedence over tenant when an account somehow holds
/// both -- mirrors the web app's own `destinationResolver.ts` precedence and `apps/android`'s
/// identical `destinationForRole()` function. Neither -- the genuine "signed in, no portal
/// access" edge case -- returns `nil`, which callers must treat as "route back to sign-in," never
/// crash on a portal with nothing to show.
enum Portal: Sendable {
    case owner
    case tenant
}

func destinationPortal(organizations: [OrgMembership], tenancies: [TenancyMembership]) -> Portal? {
    if !organizations.isEmpty { return .owner }
    if !tenancies.isEmpty { return .tenant }
    return nil
}
