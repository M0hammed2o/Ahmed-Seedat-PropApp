package za.co.proplyst.app.data.auth

/**
 * UX-layer mirror of `has_org_role()`'s exact role tiers (DATABASE.md § Org-role helper,
 * confirmed live this session via `pg_get_functiondef`) -- Invoice V1 completion pass
 * (WORKLOG.md this date), needed to decide whether to SHOW the "Record Payment" control.
 * `accountant` and `agent` are SIBLING roles, neither satisfies the other's floor; only
 * `manager`/`principal` sit strictly above both. This is UI-layer only, same disclaimer as every
 * other client-side check in this app: `requireOrgRole()` server-side (the route this app calls)
 * remains the real, authoritative enforcement -- a caller who somehow reaches this screen without
 * the right role still gets a real 403 from the server, this function only avoids showing a
 * control that would only ever fail.
 */
fun canRecordPayment(role: String): Boolean =
    role in setOf("accountant", "manager", "principal")
