package za.co.proplyst.app.navigation

/** Android V1 last local blocker pass (WORKLOG.md this date): completes App Links routing.
 * Maps a REAL apps/admin web path (the URL actually shared/tapped, e.g. from a WhatsApp template
 * CTA) to a native destination inside whichever portal's own nested NavHost owns that screen.
 * Deliberately role-neutral at this layer -- RootNavGraph (the only place that knows the
 * authenticated caller's actual role) decides whether an OwnerScreen/TenantScreen target is
 * reachable at all, this function only knows "what screen does this path mean, if any." */
sealed interface AppLinkDestination {
    data class OwnerScreen(val route: String) : AppLinkDestination
    data class TenantScreen(val route: String) : AppLinkDestination
}

/**
 * Returns null for any path with no native screen to resume into -- this is intentional, not a
 * bug to fix later, for three different reasons per path:
 * - `/activate` (tenant onboarding: account creation, legal consent, profile completion) is a
 *   genuinely web-only flow; no native equivalent screens exist, and building an account-creation
 *   UI from scratch is a real, separate undertaking out of this pass's scope.
 * - `/my-lease`, `/leases/...`, `/owner-portal/{properties,documents,activity,distributions}`
 *   have no native screen at all yet (Owner Properties exists, but not at a 1:1 web-path shape
 *   this parser could map to without an extra ID-resolution lookup this app doesn't have).
 * - Anything genuinely unrecognized (malformed, mistyped, future web-only page).
 * All three cases are handled identically and safely by the caller: fall back to the resolved
 * role's own portal home, never a crash, per this pass's own "unknown path -> safe fallback"
 * requirement -- RootNavGraph doesn't need to distinguish WHY a path wasn't handled.
 */
fun parseAppLink(path: String): AppLinkDestination? {
    val segments = path.trim('/').split('/').filter { it.isNotEmpty() }
    if (segments.isEmpty()) return null

    return when (segments[0]) {
        "my-payments" -> when {
            segments.size == 1 -> AppLinkDestination.TenantScreen(Destinations.PAYMENTS_LIST)
            segments.size == 2 && segments[1] == "report" -> AppLinkDestination.TenantScreen(Destinations.REPORT_PAYMENT)
            else -> null
        }
        "my-maintenance" -> when {
            segments.size == 1 -> AppLinkDestination.TenantScreen(Destinations.MAINTENANCE_LIST)
            segments.size == 2 && segments[1] == "new" -> AppLinkDestination.TenantScreen(Destinations.CREATE_MAINTENANCE_TICKET)
            segments.size == 2 -> AppLinkDestination.TenantScreen(Destinations.maintenanceDetail(segments[1]))
            else -> null
        }
        "my-documents" -> if (segments.size == 1) AppLinkDestination.TenantScreen(Destinations.DOCUMENTS_LIST) else null
        "notices" -> if (segments.size <= 2) AppLinkDestination.TenantScreen(Destinations.ANNOUNCEMENTS_LIST) else null
        "owner-portal" -> when {
            segments.size == 1 -> AppLinkDestination.OwnerScreen(Destinations.DASHBOARD)
            segments[1] == "payments" -> AppLinkDestination.OwnerScreen(Destinations.PAYMENT_REVIEW_LIST)
            segments[1] == "maintenance" -> AppLinkDestination.OwnerScreen(Destinations.MAINTENANCE_LIST)
            segments[1] == "summary" -> AppLinkDestination.OwnerScreen(Destinations.OWNER_SUMMARY_LIST)
            segments[1] == "settings" -> AppLinkDestination.OwnerScreen(Destinations.NOTIFICATION_SETTINGS)
            else -> null
        }
        else -> null
    }
}
