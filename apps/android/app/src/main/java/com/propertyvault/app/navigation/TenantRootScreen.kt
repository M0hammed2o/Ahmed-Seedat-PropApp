package com.propertyvault.app.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.propertyvault.app.ui.paymentreports.PaymentReportsListScreen
import com.propertyvault.app.ui.paymentreports.ReportPaymentScreen

/**
 * Tenant-portal root (Android V1 commercial-launch pass, WORKLOG.md this date, Phase 4) -- the
 * tenant-side equivalent of OwnerRootScreen. Deliberately no bottom NavigationBar for a single
 * real destination (Payments) -- this codebase's own established discipline is against building
 * dead/empty tabs (OwnerRootScreen's own comment on Operations/Finance/More). Tenant Maintenance/
 * Documents/Notices become real bottom-nav tabs once their own modules are built (disclosed gap,
 * not stubbed here).
 */
@Composable
fun TenantRootScreen() {
    val navController = rememberNavController()

    NavHost(navController = navController, startDestination = Destinations.PAYMENTS_LIST) {
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
    }
}
