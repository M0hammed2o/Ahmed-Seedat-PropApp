package za.co.proplyst.app.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppLinkParserTest {

    @Test
    fun `maps my-payments to the tenant payments list`() {
        assertEquals(AppLinkDestination.TenantScreen(Destinations.PAYMENTS_LIST), parseAppLink("/my-payments"))
    }

    @Test
    fun `maps my-payments report to the report-payment screen`() {
        assertEquals(AppLinkDestination.TenantScreen(Destinations.REPORT_PAYMENT), parseAppLink("/my-payments/report"))
    }

    @Test
    fun `maps my-maintenance to the tenant maintenance list`() {
        assertEquals(AppLinkDestination.TenantScreen(Destinations.MAINTENANCE_LIST), parseAppLink("/my-maintenance"))
    }

    @Test
    fun `maps my-maintenance new to the create-ticket screen`() {
        assertEquals(
            AppLinkDestination.TenantScreen(Destinations.CREATE_MAINTENANCE_TICKET),
            parseAppLink("/my-maintenance/new"),
        )
    }

    @Test
    fun `maps my-maintenance with a ticket id to the ticket detail screen`() {
        assertEquals(
            AppLinkDestination.TenantScreen(Destinations.maintenanceDetail("abc-123")),
            parseAppLink("/my-maintenance/abc-123"),
        )
    }

    @Test
    fun `maps my-documents to the tenant documents list`() {
        assertEquals(AppLinkDestination.TenantScreen(Destinations.DOCUMENTS_LIST), parseAppLink("/my-documents"))
    }

    @Test
    fun `maps notices to the announcements list`() {
        assertEquals(AppLinkDestination.TenantScreen(Destinations.ANNOUNCEMENTS_LIST), parseAppLink("/notices"))
    }

    @Test
    fun `maps a specific notice id to the announcements list (no per-item detail screen exists)`() {
        assertEquals(AppLinkDestination.TenantScreen(Destinations.ANNOUNCEMENTS_LIST), parseAppLink("/notices/xyz-1"))
    }

    @Test
    fun `maps owner-portal root to the owner dashboard`() {
        assertEquals(AppLinkDestination.OwnerScreen(Destinations.DASHBOARD), parseAppLink("/owner-portal"))
    }

    @Test
    fun `maps owner-portal payments to the payment review list`() {
        assertEquals(
            AppLinkDestination.OwnerScreen(Destinations.PAYMENT_REVIEW_LIST),
            parseAppLink("/owner-portal/payments"),
        )
    }

    @Test
    fun `maps owner-portal maintenance to the owner maintenance list`() {
        assertEquals(
            AppLinkDestination.OwnerScreen(Destinations.MAINTENANCE_LIST),
            parseAppLink("/owner-portal/maintenance"),
        )
    }

    @Test
    fun `maps owner-portal summary (with or without an id) to the owner summary list`() {
        assertEquals(AppLinkDestination.OwnerScreen(Destinations.OWNER_SUMMARY_LIST), parseAppLink("/owner-portal/summary"))
        assertEquals(
            AppLinkDestination.OwnerScreen(Destinations.OWNER_SUMMARY_LIST),
            parseAppLink("/owner-portal/summary/some-id"),
        )
    }

    @Test
    fun `maps owner-portal settings to notification settings`() {
        assertEquals(
            AppLinkDestination.OwnerScreen(Destinations.NOTIFICATION_SETTINGS),
            parseAppLink("/owner-portal/settings"),
        )
    }

    @Test
    fun `returns null for the tenant onboarding activation flow (no native equivalent exists)`() {
        assertNull(parseAppLink("/activate"))
    }

    @Test
    fun `returns null for owner-portal subpages with no native screen`() {
        assertNull(parseAppLink("/owner-portal/properties"))
        assertNull(parseAppLink("/owner-portal/documents"))
        assertNull(parseAppLink("/owner-portal/activity"))
        assertNull(parseAppLink("/owner-portal/distributions"))
    }

    @Test
    fun `returns null for paths with no native screen at all`() {
        assertNull(parseAppLink("/my-lease"))
        assertNull(parseAppLink("/leases/some-id"))
    }

    @Test
    fun `returns null for a completely unrecognized path`() {
        assertNull(parseAppLink("/something/totally/unknown"))
    }

    @Test
    fun `returns null for an empty or root path`() {
        assertNull(parseAppLink("/"))
        assertNull(parseAppLink(""))
    }

    @Test
    fun `tolerates a trailing slash the same as without one`() {
        assertEquals(AppLinkDestination.TenantScreen(Destinations.PAYMENTS_LIST), parseAppLink("/my-payments/"))
    }
}
