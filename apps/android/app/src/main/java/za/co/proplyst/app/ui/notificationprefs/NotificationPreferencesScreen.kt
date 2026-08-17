package za.co.proplyst.app.ui.notificationprefs

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.notificationprefs.NotificationPreference
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView

/** Notification settings (Android V1 final gap-closure pass, WORKLOG.md this date, Phase 9) --
 * human-readable category labels only (NotificationCategory.label), never a raw category or Meta
 * template token, mirroring the web app's own NotificationPreferencesForm.tsx rule exactly. Uses
 * the SAME backend preferences table every portal/channel already reads -- no separate
 * Android-only preference model. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationPreferencesScreen(
    onBack: () -> Unit,
    viewModel: NotificationPreferencesViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val busyCategory by viewModel.busyCategory.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Notification settings") }) },
    ) { padding ->
        when (val state = uiState) {
            is NotificationPreferencesUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is NotificationPreferencesUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is NotificationPreferencesUiState.Loaded -> LazyColumn(modifier = Modifier.padding(padding)) {
                items(state.preferences, key = { it.category }) { preference ->
                    PreferenceRow(
                        preference = preference,
                        busy = busyCategory == preference.category,
                        onToggle = { channel, enabled -> viewModel.toggle(preference, channel, enabled) },
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun PreferenceRow(
    preference: NotificationPreference,
    busy: Boolean,
    onToggle: (NotificationPreferencesViewModel.Channel, Boolean) -> Unit,
) {
    ListItem(
        headlineContent = { Text(preference.category.label) },
        supportingContent = {
            Row(modifier = Modifier.fillMaxWidth()) {
                LabeledCheckbox("Email", preference.emailEnabled, busy) {
                    onToggle(NotificationPreferencesViewModel.Channel.EMAIL, it)
                }
                LabeledCheckbox("Push", preference.pushEnabled, busy) {
                    onToggle(NotificationPreferencesViewModel.Channel.PUSH, it)
                }
                LabeledCheckbox("WhatsApp", preference.whatsappEnabled, busy) {
                    onToggle(NotificationPreferencesViewModel.Channel.WHATSAPP, it)
                }
            }
        },
    )
}

@Composable
private fun LabeledCheckbox(label: String, checked: Boolean, busy: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row {
        Checkbox(checked = checked, enabled = !busy, onCheckedChange = onCheckedChange)
        Text(label, style = MaterialTheme.typography.bodySmall)
    }
}
