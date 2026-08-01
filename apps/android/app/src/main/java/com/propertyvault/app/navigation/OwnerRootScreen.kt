package com.propertyvault.app.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Home
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
import com.propertyvault.app.ui.dashboard.DashboardScreen
import com.propertyvault.app.ui.properties.PropertiesListScreen
import com.propertyvault.app.ui.properties.PropertyDetailScreen

private data class BottomNavItem(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val OWNER_BOTTOM_NAV_ITEMS = listOf(
    BottomNavItem(Destinations.DASHBOARD, "Dashboard", Icons.Filled.Dashboard),
    BottomNavItem(Destinations.PROPERTIES_LIST, "Properties", Icons.Filled.Home),
    // Operations/Finance/More tabs (NATIVE_ANDROID_SPEC.md §2) follow once their modules exist
    // (TASKS.md M20/M22) -- not stubbed here with dead placeholder tabs, matching this codebase's
    // established discipline against building UI surface that does nothing.
)

/** OwnerTabView (NATIVE_ANDROID_SPEC.md §2) -- bottom NavigationBar + a nested NavHost per tab so
 * each tab keeps its own back stack independently, same behavioral goal as iOS's per-tab
 * NavigationStack. */
@Composable
fun OwnerRootScreen() {
    val navController = rememberNavController()

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
            composable(Destinations.PROPERTY_DETAIL) {
                PropertyDetailScreen(onBack = { navController.popBackStack() })
            }
        }
    }
}
