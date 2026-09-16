package za.co.proplyst.app.navigation

import org.junit.Assert.assertEquals
import org.junit.Test
import za.co.proplyst.app.data.auth.AuthState
import za.co.proplyst.app.data.auth.OrgMembership
import za.co.proplyst.app.data.auth.TenancyMembership

/**
 * Where a signed-in account lands. The third case is the one "Continue with Google" made common
 * (2026-09-16): a brand-new Google account is authenticated but belongs to no organisation and no
 * tenancy until it is set up, and it used to be routed back to the sign-in screen -- indistinguishable
 * from a failed sign-in.
 */
class PostSignInRoutingTest {

    private fun authenticated(
        organizations: List<OrgMembership> = emptyList(),
        tenancies: List<TenancyMembership> = emptyList(),
    ) = AuthState.Authenticated(userId = "user-1", organizations = organizations, tenancies = tenancies)

    private val org = OrgMembership(orgId = "org-1", role = "principal", status = "active")
    private val tenancy = TenancyMembership(tenantId = "tenant-1", orgId = "org-1", status = "active")

    @Test
    fun `an org membership opens the owner portal`() {
        assertEquals(Destinations.OWNER_ROOT, destinationForRole(authenticated(organizations = listOf(org))))
    }

    @Test
    fun `a tenancy opens the tenant portal`() {
        assertEquals(Destinations.TENANT_ROOT, destinationForRole(authenticated(tenancies = listOf(tenancy))))
    }

    @Test
    fun `an account holding both lands on the owner portal, like the web`() {
        assertEquals(
            Destinations.OWNER_ROOT,
            destinationForRole(authenticated(organizations = listOf(org), tenancies = listOf(tenancy))),
        )
    }

    @Test
    fun `a brand-new account with neither is handed off to setup, never back to sign-in`() {
        val destination = destinationForRole(authenticated())

        assertEquals(Destinations.ACCOUNT_SETUP_REQUIRED, destination)
        assertEquals("a completed sign-in must never route back to sign-in", false, destination == Destinations.SIGN_IN)
    }
}
