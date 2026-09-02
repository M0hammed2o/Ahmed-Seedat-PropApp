package za.co.proplyst.app.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import za.co.proplyst.app.ui.account.AccountScreen
import za.co.proplyst.app.ui.announcements.AnnouncementsListScreen
import za.co.proplyst.app.ui.common.FloatingBottomNav
import za.co.proplyst.app.ui.common.FloatingNavItem
import za.co.proplyst.app.ui.documents.DocumentsListScreen
import za.co.proplyst.app.ui.invoices.InvoiceDetailScreen
import za.co.proplyst.app.ui.invoices.InvoicesListScreen
import za.co.proplyst.app.ui.tenancy.MyLeaseScreen
import za.co.proplyst.app.ui.tenancy.TenantHomeScreen
import za.co.proplyst.app.ui.tenancy.TenantProfileScreen
import za.co.proplyst.app.ui.maintenance.CreateMaintenanceTicketScreen
import za.co.proplyst.app.ui.maintenance.MaintenanceDetailScreen
import za.co.proplyst.app.ui.maintenance.MaintenanceListScreen
import za.co.proplyst.app.ui.more.AppearanceScreen
import za.co.proplyst.app.ui.notifications.NotificationsListScreen
import za.co.proplyst.app.ui.notificationprefs.NotificationPreferencesScreen
import za.co.proplyst.app.ui.paymentreports.PaymentReportsListScreen
import za.co.proplyst.app.ui.paymentreports.ReportPaymentScreen

/** Proplyst Mobile Design System redesign pass -- tenant IA collapsed from 6 top-level tabs to the
 * 4 the approved Navy Deck direction specifies: Home · Payments · Requests · Profile. "Payments"
 * is the authoritative invoice/balance ledger (INVOICES_LIST, unchanged data source); the
 * separate tenant-reported-claim workflow (PAYMENTS_LIST/REPORT_PAYMENT) stays reachable from
 * Tenant Home's "Report payment" CTA and from inside the Payments tab, never merged into one
 * concept with the ledger. "Requests" is Maintenance; "Profile" replaces the old bare Account
 * entry point with the richer identity/lease summary + settings list. */
private val TENANT_BOTTOM_NAV_ITEMS: List<FloatingNavItem> = listOf(
    FloatingNavItem(Destinations.TENANT_HOME, "Home", Icons.Outlined.Home),
    FloatingNavItem(Destinations.INVOICES_LIST, "Payments", Icons.AutoMirrored.Outlined.ReceiptLong),
    FloatingNavItem(Destinations.MAINTENANCE_LIST, "Requests", Icons.Outlined.Build),
    FloatingNavItem(Destinations.TENANT_PROFILE, "Profile", Icons.Outlined.Person),
)

@Composable
fun TenantRootScreen(pendingRoute: String? = null) {
    val navController = rememberNavController()

    // App Link resume (Android V1 last local blocker pass, WORKLOG.md this date) -- see
    // OwnerRootScreen's identical LaunchedEffect for why this is a post-graph navigate hop rather
    // than a dynamic startDestination.
    LaunchedEffect(pendingRoute) {
        if (pendingRoute != null) navController.navigate(pendingRoute)
    }

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    Box(modifier = Modifier.fillMaxSize()) {
        NavHost(
            navController = navController,
            startDestination = Destinations.TENANT_HOME,
            modifier = Modifier.fillMaxSize(),
        ) {
            composable(Destinations.TENANT_HOME) {
                TenantHomeScreen(
                    onNotificationsClick = { navController.navigate(Destinations.NOTIFICATIONS_LIST) },
                    onReportPaymentClick = { navController.navigate(Destinations.REPORT_PAYMENT) },
                    onInvoicesClick = { navController.navigate(Destinations.INVOICES_LIST) },
                    onRequestsClick = { navController.navigate(Destinations.MAINTENANCE_LIST) },
                    onNewRequestClick = { navController.navigate(Destinations.CREATE_MAINTENANCE_TICKET) },
                    onNoticesClick = { navController.navigate(Destinations.ANNOUNCEMENTS_LIST) },
                    onDocumentsClick = { navController.navigate(Destinations.DOCUMENTS_LIST) },
                    onAccountClick = { navController.navigate(Destinations.ACCOUNT) },
                )
            }
            composable(Destinations.INVOICES_LIST) {
                InvoicesListScreen(
                    onInvoiceClick = { invoiceId -> navController.navigate(Destinations.invoiceDetail(invoiceId)) },
                )
            }
            composable(Destinations.INVOICE_DETAIL) {
                // No onRecordPaymentClick -- a tenant is never accountant+ org role, so
                // InvoiceDetailViewModel.canRecordPayment is always false for this caller anyway;
                // omitted here rather than passed-but-never-true, so this NavHost never even
                // references RECORD_PAYMENT (a route with no destination registered in this
                // NavHost at all -- there is no code path by which a tenant could navigate to it).
                InvoiceDetailScreen(onBack = { navController.popBackStack() })
            }
            composable(Destinations.PAYMENTS_LIST) {
                PaymentReportsListScreen(
                    onReportPaymentClick = { navController.navigate(Destinations.REPORT_PAYMENT) },
                )
            }
            composable(Destinations.REPORT_PAYMENT) {
                ReportPaymentScreen(
                    onSubmitted = { navController.popBackStack() },
                    onCancel = { navController.popBackStack() },
                )
            }
            composable(Destinations.MAINTENANCE_LIST) {
                MaintenanceListScreen(
                    onTicketClick = { ticketId -> navController.navigate(Destinations.maintenanceDetail(ticketId)) },
                    onCreateClick = { navController.navigate(Destinations.CREATE_MAINTENANCE_TICKET) },
                )
            }
            composable(Destinations.MAINTENANCE_DETAIL) {
                MaintenanceDetailScreen(onBack = { navController.popBackStack() })
            }
            composable(Destinations.CREATE_MAINTENANCE_TICKET) {
                CreateMaintenanceTicketScreen(
                    onSubmitted = { navController.popBackStack() },
                    onCancel = { navController.popBackStack() },
                )
            }
            composable(Destinations.DOCUMENTS_LIST) {
                DocumentsListScreen()
            }
            composable(Destinations.ANNOUNCEMENTS_LIST) {
                AnnouncementsListScreen()
            }
            composable(Destinations.NOTIFICATIONS_LIST) {
                NotificationsListScreen(
                    onSettingsClick = { navController.navigate(Destinations.NOTIFICATION_SETTINGS) },
                    onAccountClick = { navController.navigate(Destinations.ACCOUNT) },
                )
            }
            composable(Destinations.NOTIFICATION_SETTINGS) {
                NotificationPreferencesScreen(onBack = { navController.popBackStack() })
            }
            composable(Destinations.TENANT_PROFILE) {
                TenantProfileScreen(
                    onMyLeaseClick = { navController.navigate(Destinations.MY_LEASE) },
                    onDocumentsClick = { navController.navigate(Destinations.DOCUMENTS_LIST) },
                    onNoticesClick = { navController.navigate(Destinations.ANNOUNCEMENTS_LIST) },
                    onAccountClick = { navController.navigate(Destinations.ACCOUNT) },
                    onAppearanceClick = { navController.navigate(Destinations.APPEARANCE_SETTINGS) },
                )
            }
            composable(Destinations.APPEARANCE_SETTINGS) {
                AppearanceScreen(onBack = { navController.popBackStack() })
            }
            composable(Destinations.ACCOUNT) {
                AccountScreen(
                    onBack = { navController.popBackStack() },
                    onMyLeaseClick = { navController.navigate(Destinations.MY_LEASE) },
                )
            }
            composable(Destinations.MY_LEASE) {
                MyLeaseScreen(onBack = { navController.popBackStack() })
            }
        }

        val showBottomNav = TENANT_BOTTOM_NAV_ITEMS.any { item -> currentDestination?.hierarchy?.any { it.route == item.route } == true }
        if (showBottomNav) {
            FloatingBottomNav(
                items = TENANT_BOTTOM_NAV_ITEMS,
                currentRoute = currentDestination?.route,
                onItemClick = { item ->
                    navController.navigate(item.route) {
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }
    }
}
