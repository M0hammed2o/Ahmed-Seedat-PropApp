package za.co.proplyst.app.ui.announcements

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.announcements.Announcement
import za.co.proplyst.app.ui.common.ProplystScreenScaffold
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Surface
import androidx.compose.ui.graphics.Color
import za.co.proplyst.app.ui.common.StatusChip
import za.co.proplyst.app.ui.common.StatusTone
import za.co.proplyst.app.ui.common.relativeTimeLabel
import za.co.proplyst.app.ui.theme.ProplystPillShape
import za.co.proplyst.app.ui.theme.ProplystTheme
import androidx.compose.foundation.layout.PaddingValues

/** Tenant "Notices" (Android V1 final gap-closure pass, WORKLOG.md this date, Phase 6; read/
 * unread tracking added in the following last-local-blocker pass). RLS scopes the list to
 * portfolio-wide announcements plus this tenant's own leased property (see
 * AnnouncementsRepository's doc comment). Announcements that require acknowledgement get an
 * explicit button (a deliberate action); others are marked read on tap, same "tap the row to mark
 * read" convention NotificationsListScreen already uses. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnnouncementsListScreen(viewModel: AnnouncementsViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val busyId by viewModel.busyId.collectAsState()
    val actionError by viewModel.actionError.collectAsState()

    ProplystScreenScaffold(
        title = "Notices",
        eyebrow = "Communication",
    ) { padding ->
        when (val state = uiState) {
            is AnnouncementsUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is AnnouncementsUiState.Empty -> EmptyStateView(
                title = "No notices yet",
                description = "Notices sent to your tenants will appear here.",
                modifier = Modifier.padding(padding),
            )
            is AnnouncementsUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is AnnouncementsUiState.Loaded -> LazyColumn(
                modifier = Modifier.padding(padding).background(ProplystTheme.colors.background),
                contentPadding = PaddingValues(top = 8.dp, bottom = 96.dp),
            ) {
                if (actionError != null) {
                    item {
                        Surface(
                            color = ProplystTheme.colors.criticalBg,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        ) {
                            Text(
                                actionError.orEmpty(),
                                style = ProplystTheme.type.body,
                                color = ProplystTheme.colors.criticalDeep,
                                modifier = Modifier.padding(12.dp),
                            )
                        }
                    }
                }
                items(state.announcements, key = { it.id }) { announcement ->
                    AnnouncementCard(
                        announcement = announcement,
                        busy = busyId == announcement.id,
                        onAcknowledge = { viewModel.acknowledge(announcement.id) },
                        onView = { viewModel.markReadIfUnread(announcement) },
                    )
                }
            }
        }
    }
}

@Composable
private fun AnnouncementCard(
    announcement: Announcement,
    busy: Boolean,
    onAcknowledge: () -> Unit,
    onView: () -> Unit,
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val unread = announcement.readAt == null

    Surface(
        color = colors.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 5.dp)
            .clickable(enabled = unread && !announcement.requiresAcknowledgement, onClick = onView),
    ) {
        Row(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
            // Unread marker in the Proplyst accent, rather than tinting the whole card grey.
            Box(
                modifier = Modifier
                    .padding(top = 5.dp, end = 12.dp)
                    .size(8.dp)
                    .background(if (unread) colors.primary else Color.Transparent, CircleShape),
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    announcement.title,
                    style = type.cardTitle,
                    color = colors.textPrimary,
                    fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Medium,
                )
                Text(
                    relativeTimeLabel(announcement.publishedAt),
                    style = type.meta,
                    color = colors.textTertiary,
                    modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
                )
                Text(announcement.body, style = type.body, color = colors.textSecondary)
                if (announcement.requiresAcknowledgement) {
                    if (!unread) {
                        StatusChip(
                            label = "Acknowledged",
                            tone = StatusTone.POSITIVE,
                            modifier = Modifier.padding(top = 10.dp),
                        )
                    } else {
                        Button(
                            onClick = onAcknowledge,
                            enabled = !busy,
                            shape = ProplystPillShape,
                            colors = ButtonDefaults.buttonColors(containerColor = colors.primary),
                            modifier = Modifier.padding(top = 10.dp),
                        ) {
                            Text(if (busy) "Acknowledging…" else "Acknowledge", style = type.button)
                        }
                    }
                }
            }
        }
    }
}
