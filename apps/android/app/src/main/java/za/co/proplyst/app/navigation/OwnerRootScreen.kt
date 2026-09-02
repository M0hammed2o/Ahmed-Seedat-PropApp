package za.co.proplyst.app.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.outlined.Apartment
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.MoreHoriz
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
import za.co.proplyst.app.ui.common.FloatingBottomNav
import za.co.proplyst.app.ui.common.FloatingNavItem
import za.co.proplyst.app.ui.dashboard.DashboardScreen
import za.co.proplyst.app.ui.invoices.InvoiceDetailScreen
import za.co.proplyst.app.ui.invoices.InvoicesListScreen
import za.co.proplyst.app.ui.invoices.RecordPaymentScreen
import za.co.proplyst.app.ui.leases.LeaseDetailScreen
import za.co.proplyst.app.ui.leases.LeasesListScreen
import za.co.proplyst.app.ui.maintenance.MaintenanceDetailScreen
import za.co.proplyst.app.ui.maintenance.MaintenanceListScreen
import za.co.proplyst.app.ui.more.AppearanceScreen
import za.co.proplyst.app.ui.more.OwnerMoreScreen
import za.co.proplyst.app.ui.notifications.NotificationsListScreen
import za.co.proplyst.app.ui.notificationprefs.NotificationPreferencesScreen
import za.co.proplyst.app.ui.paymentreview.PaymentReviewListScreen
import za.co.proplyst.app.ui.ownersummary.OwnerSummaryListScreen
import za.co.proplyst.app.ui.rentstatus.RentStatusListScreen
import za.co.proplyst.app.ui.expenses.AddExpenseScreen
import za.co.proplyst.app.ui.utilities.UtilityCaptureScreen
import za.co.proplyst.app.ui.utilities.UtilityHistoryScreen
import za.co.proplyst.app.ui.budget.BudgetViewScreen
import za.co.proplyst.app.ui.announcements.AnnouncementsListScreen
import za.co.proplyst.app.ui.properties.PropertiesListScreen
import za.co.proplyst.app.ui.properties.PropertyDetailScreen
import za.co.proplyst.app.ui.tenants.TenantDetailScreen
import za.co.proplyst.app.ui.tenants.TenantsListScreen
import za.co.proplyst.app.ui.units.UnitDetailScreen
import za.co.proplyst.app.ui.units.UnitsListScreen

/** Proplyst Mobile Design System redesign pass -- owner IA collapsed from 8 top-level tabs to the
 * 4 the approved Navy Deck direction specifies (design handoff, "final navigation override"):
 * Home · Properties · Activity · More. Every screen the old tabs exposed directly is still fully
 * reachable, just nested one level deeper (Properties -> property -> Units/Tenants/Maintenance/
 * Documents; More -> Invoices/Tenants/Payment review/Maintenance/Documents/Notices/Reports). */
private val OWNER_BOTTOM_NAV_ITEMS: List<FloatingNavItem> = listOf(
    FloatingNavItem(Destinations.DASHBOARD, "Home", Icons.Outlined.Home),
    FloatingNavItem(Destinations.PROPERTIES_LIST, "Properties", Icons.Outlined.Apartment),
    FloatingNavItem(Destinations.OWNER_ACTIVITY, "Activity", Icons.AutoMirrored.Outlined.List),
    FloatingNavItem(Destinations.OWNER_MORE, "More", Icons.Outlined.MoreHoriz),
)

/** OwnerTabView (NATIVE_ANDROID_SPEC.md §2) -- floating white pill bottom nav + a nested NavHost
 * per tab so each tab keeps its own back stack independently, same behavioral goal as iOS's
 * per-tab NavigationStack. */
@Composable
fun OwnerRootScreen(pendingRoute: String? = null) {
    val navController = rememberNavController()

    // App Link resume (Android V1 last local blocker pass, WORKLOG.md this date): one extra hop
    // right after this NavHost's own graph is built, landing on Dashboard first then navigating
    // to the deep-linked tab/screen -- NavHost's startDestination can't be switched dynamically,
    // so this is the same "navigate immediately after the graph exists" pattern used to resume
    // App Links across a nested NavHost boundary.
    LaunchedEffect(pendingRoute) {
        if (pendingRoute != null) navController.navigate(pendingRoute)
    }

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    Box(modifier = Modifier.fillMaxSize()) {
        NavHost(
            navController = navController,
            startDestination = Destinations.DASHBOARD,
            modifier = Modifier.fillMaxSize(),
        ) {
            composable(Destinations.DASHBOARD) {
                DashboardScreen(
                    onNotificationsClick = { navController.navigate(Destinations.OWNER_ACTIVITY) },
                    onPropertyClick = { propertyId -> navController.navigate(Destinations.propertyDetail(propertyId)) },
                    onAccountClick = { navController.navigate(Destinations.ACCOUNT) },
                )
            }
            composable(Destinations.PROPERTIES_LIST) {
                PropertiesListScreen(
                    onPropertyClick = { propertyId ->
                        navController.navigate(Destinations.propertyDetail(propertyId))
                    },
                )
            }
            composable(Destinations.PROPERTY_DETAIL) { backStackEntry ->
                val propertyId = checkNotNull(backStackEntry.arguments?.getString("propertyId"))
                PropertyDetailScreen(
                    onBack = { navController.popBackStack() },
                    onViewUnits = { navController.navigate(Destinations.unitsList(propertyId)) },
                    onViewTenants = { navController.navigate(Destinations.TENANTS_LIST) },
                    onViewMaintenance = { navController.navigate(Destinations.MAINTENANCE_LIST) },
                )
            }
            composable(Destinations.UNITS_LIST) { backStackEntry ->
                val propertyId = checkNotNull(backStackEntry.arguments?.getString("propertyId"))
                UnitsListScreen(
                    onBack = { navController.popBackStack() },
                    onUnitClick = { unitId ->
                        navController.navigate(Destinations.unitDetail(propertyId, unitId))
                    },
                )
            }
            composable(Destinations.UNIT_DETAIL) { backStackEntry ->
                val propertyId = checkNotNull(backStackEntry.arguments?.getString("propertyId"))
                val unitId = checkNotNull(backStackEntry.arguments?.getString("unitId"))
                UnitDetailScreen(
                    onBack = { navController.popBackStack() },
                    onViewLeases = { navController.navigate(Destinations.leasesList(propertyId, unitId)) },
                )
            }
            composable(Destinations.LEASES_LIST) { backStackEntry ->
                val propertyId = checkNotNull(backStackEntry.arguments?.getString("propertyId"))
                val unitId = checkNotNull(backStackEntry.arguments?.getString("unitId"))
                LeasesListScreen(
                    onBack = { navController.popBackStack() },
                    onLeaseClick = { leaseId ->
                        navController.navigate(Destinations.leaseDetail(propertyId, unitId, leaseId))
                    },
                )
            }
            composable(Destinations.LEASE_DETAIL) {
                LeaseDetailScreen(onBack = { navController.popBackStack() })
            }
            composable(Destinations.TENANTS_LIST) {
                TenantsListScreen(
                    onTenantClick = { tenantId -> navController.navigate(Destinations.tenantDetail(tenantId)) },
                )
            }
            composable(Destinations.TENANT_DETAIL) {
                TenantDetailScreen(onBack = { navController.popBackStack() })
            }
            composable(Destinations.MAINTENANCE_LIST) {
                MaintenanceListScreen(
                    onTicketClick = { ticketId -> navController.navigate(Destinations.maintenanceDetail(ticketId)) },
                )
            }
            composable(Destinations.MAINTENANCE_DETAIL) {
                MaintenanceDetailScreen(onBack = { navController.popBackStack() })
            }
            composable(Destinations.ANNOUNCEMENTS_LIST) {
                AnnouncementsListScreen()
            }
            composable(Destinations.INVOICES_LIST) {
                InvoicesListScreen(
                    onInvoiceClick = { invoiceId -> navController.navigate(Destinations.invoiceDetail(invoiceId)) },
                )
            }
            composable(Destinations.INVOICE_DETAIL) { backStackEntry ->
                val invoiceId = checkNotNull(backStackEntry.arguments?.getString("invoiceId"))
                InvoiceDetailScreen(
                    onBack = { navController.popBackStack() },
                    onRecordPaymentClick = { navController.navigate(Destinations.recordPayment(invoiceId)) },
                )
            }
            composable(Destinations.RECORD_PAYMENT) {
                RecordPaymentScreen(
                    onSubmitted = { navController.popBackStack() },
                    onCancel = { navController.popBackStack() },
                )
            }
            composable(Destinations.PAYMENT_REVIEW_LIST) {
                PaymentReviewListScreen()
            }
            composable(Destinations.OWNER_SUMMARY_LIST) {
                OwnerSummaryListScreen()
            }
            composable(Destinations.RENT_STATUS_LIST) {
                RentStatusListScreen(onBack = { navController.popBackStack() })
            }
            composable(Destinations.ADD_EXPENSE) {
                AddExpenseScreen(
                    onBack = { navController.popBackStack() },
                    onSubmitted = { navController.popBackStack() },
                )
            }
            composable(Destinations.UTILITY_CAPTURE) {
                UtilityCaptureScreen(
                    onBack = { navController.popBackStack() },
                    onSubmitted = { navController.popBackStack() },
                )
            }
            composable(Destinations.UTILITY_HISTORY) {
                UtilityHistoryScreen(onBack = { navController.popBackStack() })
            }
            composable(Destinations.BUDGET_VIEW) {
                BudgetViewScreen(onBack = { navController.popBackStack() })
            }
            composable(Destinations.OWNER_ACTIVITY) {
                NotificationsListScreen(
                    onSettingsClick = { navController.navigate(Destinations.NOTIFICATION_SETTINGS) },
                    onAccountClick = { navController.navigate(Destinations.ACCOUNT) },
                )
            }
            composable(Destinations.NOTIFICATION_SETTINGS) {
                NotificationPreferencesScreen(onBack = { navController.popBackStack() })
            }
            composable(Destinations.OWNER_MORE) {
                OwnerMoreScreen(
                    onInvoicesClick = { navController.navigate(Destinations.INVOICES_LIST) },
                    onTenantsClick = { navController.navigate(Destinations.TENANTS_LIST) },
                    onPaymentReviewClick = { navController.navigate(Destinations.PAYMENT_REVIEW_LIST) },
                    onRentStatusClick = { navController.navigate(Destinations.RENT_STATUS_LIST) },
                    onAddExpenseClick = { navController.navigate(Destinations.ADD_EXPENSE) },
                    onUtilityCaptureClick = { navController.navigate(Destinations.UTILITY_CAPTURE) },
                    onUtilityHistoryClick = { navController.navigate(Destinations.UTILITY_HISTORY) },
                    onBudgetClick = { navController.navigate(Destinations.BUDGET_VIEW) },
                    onMaintenanceClick = { navController.navigate(Destinations.MAINTENANCE_LIST) },
                    onNoticesClick = { navController.navigate(Destinations.ANNOUNCEMENTS_LIST) },
                    onSummaryClick = { navController.navigate(Destinations.OWNER_SUMMARY_LIST) },
                    onAccountClick = { navController.navigate(Destinations.ACCOUNT) },
                    onAppearanceClick = { navController.navigate(Destinations.APPEARANCE_SETTINGS) },
                )
            }
            composable(Destinations.APPEARANCE_SETTINGS) {
                AppearanceScreen(onBack = { navController.popBackStack() })
            }
            composable(Destinations.ACCOUNT) {
                AccountScreen(onBack = { navController.popBackStack() })
            }
        }

        val showBottomNav = OWNER_BOTTOM_NAV_ITEMS.any { item -> currentDestination?.hierarchy?.any { it.route == item.route } == true }
        if (showBottomNav) {
            FloatingBottomNav(
                items = OWNER_BOTTOM_NAV_ITEMS,
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
