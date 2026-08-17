package za.co.proplyst.app.ui.announcements

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.announcements.Announcement
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView

/** Tenant "Notices" (Android V1 final gap-closure pass, WORKLOG.md this date, Phase 6) -- RLS
 * scopes the list to portfolio-wide announcements plus this tenant's own leased property (see
 * AnnouncementsRepository's doc comment). Only announcements that require acknowledgement get an
 * action; others are informational only. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnnouncementsListScreen(viewModel: AnnouncementsViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val busyId by viewModel.busyId.collectAsState()
    val acknowledgedIds by viewModel.acknowledgedIds.collectAsState()
    val actionError by viewModel.actionError.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Notices") }) },
    ) { padding ->
        when (val state = uiState) {
            is AnnouncementsUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is AnnouncementsUiState.Empty -> EmptyStateView(
                title = "No notices yet",
                modifier = Modifier.padding(padding),
            )
            is AnnouncementsUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is AnnouncementsUiState.Loaded -> LazyColumn(modifier = Modifier.padding(padding)) {
                if (actionError != null) {
                    item {
                        Text(
                            actionError.orEmpty(),
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(16.dp),
                        )
                    }
                }
                items(state.announcements, key = { it.id }) { announcement ->
                    AnnouncementCard(
                        announcement = announcement,
                        acknowledged = announcement.id in acknowledgedIds,
                        busy = busyId == announcement.id,
                        onAcknowledge = { viewModel.acknowledge(announcement.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun AnnouncementCard(
    announcement: Announcement,
    acknowledged: Boolean,
    busy: Boolean,
    onAcknowledge: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(announcement.title, style = MaterialTheme.typography.titleMedium)
            Text(
                announcement.publishedAt.take(10),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
            )
            Text(announcement.body, style = MaterialTheme.typography.bodyMedium)
            if (announcement.requiresAcknowledgement) {
                if (acknowledged) {
                    Text(
                        "Acknowledged",
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                } else {
                    TextButton(onClick = onAcknowledge, enabled = !busy, modifier = Modifier.padding(top = 4.dp)) {
                        Text(if (busy) "Acknowledging…" else "Acknowledge")
                    }
                }
            }
        }
    }
}
