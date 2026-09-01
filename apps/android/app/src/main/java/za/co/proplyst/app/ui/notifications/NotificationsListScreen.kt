package za.co.proplyst.app.ui.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
    viewModel: NotificationsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Notifications") },
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
                title = "No notifications yet",
                modifier = Modifier.padding(padding),
            )
            is NotificationsUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is NotificationsUiState.Loaded -> LazyColumn(modifier = Modifier.padding(padding)) {
                items(state.notifications, key = { it.id }) { notification ->
                    NotificationRow(notification, onClick = { viewModel.markRead(notification.id) })
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun NotificationRow(notification: AppNotification, onClick: () -> Unit) {
    val unread = notification.readAt == null
    ListItem(
        headlineContent = {
            Text(notification.title, fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal)
        },
        supportingContent = notification.body?.let { { Text(it) } },
        trailingContent = { Text(notification.createdAt.take(10), style = MaterialTheme.typography.bodySmall) },
        modifier = Modifier
            .fillMaxWidth()
            .background(if (unread) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface)
            .clickable(enabled = unread, onClick = onClick),
    )
}
