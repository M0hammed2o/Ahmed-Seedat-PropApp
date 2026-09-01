package za.co.proplyst.app.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import za.co.proplyst.app.ui.account.AccountScreen
import za.co.proplyst.app.ui.dashboard.DashboardScreen
import za.co.proplyst.app.ui.leases.LeaseDetailScreen
import za.co.proplyst.app.ui.leases.LeasesListScreen
import za.co.proplyst.app.ui.maintenance.MaintenanceDetailScreen
import za.co.proplyst.app.ui.maintenance.MaintenanceListScreen
import za.co.proplyst.app.ui.notifications.NotificationsListScreen
import za.co.proplyst.app.ui.notificationprefs.NotificationPreferencesScreen
import za.co.proplyst.app.ui.paymentreview.PaymentReviewListScreen
import za.co.proplyst.app.ui.ownersummary.OwnerSummaryListScreen
import za.co.proplyst.app.ui.properties.PropertiesListScreen
import za.co.proplyst.app.ui.properties.PropertyDetailScreen
import za.co.proplyst.app.ui.tenants.TenantDetailScreen
import za.co.proplyst.app.ui.tenants.TenantsListScreen
import za.co.proplyst.app.ui.units.UnitDetailScreen
import za.co.proplyst.app.ui.units.UnitsListScreen

private data class OwnerBottomNavItem(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val OWNER_BOTTOM_NAV_ITEMS: List<OwnerBottomNavItem> = listOf(
    OwnerBottomNavItem(Destinations.DASHBOARD, "Dashboard", Icons.Filled.Dashboard),
    OwnerBottomNavItem(Destinations.PROPERTIES_LIST, "Properties", Icons.Filled.Home),
    OwnerBottomNavItem(Destinations.TENANTS_LIST, "Tenants", Icons.Filled.People),
    OwnerBottomNavItem(Destinations.PAYMENT_REVIEW_LIST, "Payments", Icons.Filled.Receipt),
    OwnerBottomNavItem(Destinations.MAINTENANCE_LIST, "Maintenance", Icons.Filled.Build),
    OwnerBottomNavItem(Destinations.OWNER_SUMMARY_LIST, "Summary", Icons.Filled.Assessment),
    OwnerBottomNavItem(Destinations.NOTIFICATIONS_LIST, "Alerts", Icons.Filled.Notifications),
    // 7 tabs (Android V1 final gap-closure pass, WORKLOG.md this date, adds Payments/Summary/
    // Alerts) -- well above Material's usual 5-tab comfort guidance. A real, disclosed P2 UX gap
    // (needs a "More" overflow grouping, a considered design pass, not invented here) -- every
    // tab is still a real, reachable feature, which matters more than tab-count aesthetics for
    // this pass. Operations/Finance/More tabs from NATIVE_ANDROID_SPEC.md §2 remain unbuilt --
    // not stubbed with dead tabs.
)

/** OwnerTabView (NATIVE_ANDROID_SPEC.md §2) -- bottom NavigationBar + a nested NavHost per tab so
 * each tab keeps its own back stack independently, same behavioral goal as iOS's per-tab
 * NavigationStack. */
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

    Scaffold(
        bottomBar = {
            NavigationBar {
                val navBackStackEntry by navController.currentBackStackEntryAsState()
                val currentDestination = navBackStackEntry?.destination

                OWNER_BOTTOM_NAV_ITEMS.forEach { item ->
                    NavigationBarItem(
                        icon = { Icon(item.icon, contentDescription = item.label) },
                        label = { Text(item.label) },
                        selected = currentDestination?.hierarchy?.any { it.route == item.route } == true,
                        onClick = {
                            navController.navigate(item.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Destinations.DASHBOARD,
            modifier = Modifier.padding(padding),
        ) {
            composable(Destinations.DASHBOARD) { DashboardScreen() }
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
            composable(Destinations.PAYMENT_REVIEW_LIST) {
                PaymentReviewListScreen()
            }
            composable(Destinations.OWNER_SUMMARY_LIST) {
                OwnerSummaryListScreen()
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
            composable(Destinations.ACCOUNT) {
                AccountScreen(onBack = { navController.popBackStack() })
            }
        }
    }
}
