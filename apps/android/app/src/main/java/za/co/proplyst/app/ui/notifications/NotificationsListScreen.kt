package za.co.proplyst.app.ui.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import za.co.proplyst.app.navigation.AttentionDestination
import za.co.proplyst.app.navigation.destinationForNotification
import za.co.proplyst.app.data.notifications.AppNotification
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView

/** In-app notification centre (Android V1 final gap-closure pass, WORKLOG.md this date, Phase
 * 7). RLS (`notifications_select_own`) scopes this to the caller's own notifications regardless
 * of portal -- shared between Owner and Tenant, same as web's own /notifications page. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsListScreen(
    onSettingsClick: () -> Unit,
    onAccountClick: () -> Unit,
    /** Opens the record an activity refers to. Default is a no-op so the Tenant portal, whose
     * activities are informational, can keep mounting this screen unchanged. */
    onOpenRoute: (String) -> Unit = {},
    viewModel: NotificationsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    // Returning from a destination that may have changed things -- a closed ticket, a confirmed
    // payment -- must not leave stale history on screen. Refresh keeps the current list visible
    // while it reloads, unlike the initial load.
    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose { }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                // "Activity", matching the bottom-nav tab that opens this screen and Home's own
                // "Recent activity" section, whose "View all" lands right here on the same feed --
                // the tab said Activity while the screen said Notifications (visual QA,
                // 2026-09-08). This destination is the portfolio's activity history; the gear
                // beside it still says "Notification settings", because that one genuinely
                // configures notification delivery.
                title = { Text("Activity") },
                actions = {
                    IconButton(onClick = onAccountClick) {
                        Icon(Icons.Filled.AccountCircle, contentDescription = "Account")
                    }
                    IconButton(onClick = onSettingsClick) {
                        Icon(Icons.Filled.Settings, contentDescription = "Notification settings")
                    }
                },
            )
        },
    ) { padding ->
        when (val state = uiState) {
            is NotificationsUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is NotificationsUiState.Empty -> EmptyStateView(
                title = "No activity yet",
                description = "Payments, expenses and maintenance updates appear here as they happen.",
                modifier = Modifier.padding(padding),
            )
            is NotificationsUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            // FloatingBottomNav is drawn by OwnerRootScreen/TenantRootScreen as an overlay in a Box
            // ON TOP of this NavHost, so the Scaffold's own insets know nothing about it and every
            // scrollable tab destination has to reserve the space itself -- Home already does, with
            // `.padding(bottom = 64.dp)`. Without this the final activity was pinned under the bar,
            // squeezed to an 11 dp-wide sliver, and simply could not be tapped: the lease-expiry row
            // was unreachable on the emulator no matter how far the list was scrolled.
            is NotificationsUiState.Loaded -> LazyColumn(
                modifier = Modifier.padding(padding),
                contentPadding = PaddingValues(bottom = 96.dp),
            ) {
                items(state.notifications, key = { it.id }) { notification ->
                    val destination = destinationForNotification(notification)
                    NotificationRow(
                        notification = notification,
                        // An activity with no resolvable record is still openable -- opening is
                        // what marks it read -- it just has nowhere to go afterwards.
                        hasDestination = destination is AttentionDestination.Route,
                        onClick = {
                            viewModel.markRead(notification.id)
                            (destination as? AttentionDestination.Route)?.let { onOpenRoute(it.route) }
                        },
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

/**
 * One activity row.
 *
 * The whole row is the target. It used to be `clickable(enabled = unread)`, so the moment an
 * activity was read it went inert -- an owner could open "Payment awaiting confirmation" once,
 * glance at it, and then find the row permanently untappable with the payment still unconfirmed.
 * Read state is a styling concern, never a reason to withhold the destination.
 */
@Composable
private fun NotificationRow(
    notification: AppNotification,
    hasDestination: Boolean,
    onClick: () -> Unit,
) {
    val unread = notification.readAt == null
    ListItem(
        headlineContent = {
            Text(notification.title, fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal)
        },
        supportingContent = notification.body?.let { { Text(it) } },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(notification.createdAt.take(10), style = MaterialTheme.typography.bodySmall)
                // The one affordance added here: a chevron, only on rows that actually lead
                // somewhere, so "tappable" is visible without decorating every row in the feed.
                if (hasDestination) {
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        modifier = Modifier.padding(start = 4.dp),
                    )
                }
            }
        },
        modifier = Modifier
            .fillMaxWidth()
            .background(if (unread) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick),
    )
}
