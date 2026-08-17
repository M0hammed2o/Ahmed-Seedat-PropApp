package za.co.proplyst.app.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import za.co.proplyst.app.ui.announcements.AnnouncementsListScreen
import za.co.proplyst.app.ui.documents.DocumentsListScreen
import za.co.proplyst.app.ui.maintenance.CreateMaintenanceTicketScreen
import za.co.proplyst.app.ui.maintenance.MaintenanceDetailScreen
import za.co.proplyst.app.ui.maintenance.MaintenanceListScreen
import za.co.proplyst.app.ui.notifications.NotificationsListScreen
import za.co.proplyst.app.ui.notificationprefs.NotificationPreferencesScreen
import za.co.proplyst.app.ui.paymentreports.PaymentReportsListScreen
import za.co.proplyst.app.ui.paymentreports.ReportPaymentScreen

private data class TenantBottomNavItem(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val TENANT_BOTTOM_NAV_ITEMS: List<TenantBottomNavItem> = listOf(
    TenantBottomNavItem(Destinations.PAYMENTS_LIST, "Payments", Icons.Filled.Receipt),
    TenantBottomNavItem(Destinations.MAINTENANCE_LIST, "Maintenance", Icons.Filled.Build),
    TenantBottomNavItem(Destinations.DOCUMENTS_LIST, "Documents", Icons.Filled.Description),
    TenantBottomNavItem(Destinations.ANNOUNCEMENTS_LIST, "Notices", Icons.Filled.Campaign),
    TenantBottomNavItem(Destinations.NOTIFICATIONS_LIST, "Alerts", Icons.Filled.Notifications),
    // Android V1 final gap-closure pass (WORKLOG.md this date) adds Maintenance/Documents/
    // Notices/Alerts alongside the prior pass's Payments -- every tenant V1 gap this pass set out
    // to close now has a real, reachable tab.
)

/**
 * Tenant-portal root (Android V1 commercial-launch pass, WORKLOG.md this date, Phase 4; extended
 * with a real bottom nav this pass now that a second real destination -- Alerts -- exists).
 */
@Composable
fun TenantRootScreen() {
    val navController = rememberNavController()

    Scaffold(
        bottomBar = {
            NavigationBar {
                val navBackStackEntry by navController.currentBackStackEntryAsState()
                val currentDestination = navBackStackEntry?.destination

                TENANT_BOTTOM_NAV_ITEMS.forEach { item ->
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
            startDestination = Destinations.PAYMENTS_LIST,
            modifier = Modifier.padding(padding),
        ) {
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
                )
            }
            composable(Destinations.NOTIFICATION_SETTINGS) {
                NotificationPreferencesScreen(onBack = { navController.popBackStack() })
            }
        }
    }
}
