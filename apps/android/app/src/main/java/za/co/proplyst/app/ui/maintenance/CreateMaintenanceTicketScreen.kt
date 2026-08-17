package za.co.proplyst.app.ui.maintenance

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

private val PRIORITIES = listOf("low" to "Low", "medium" to "Medium", "high" to "High", "urgent" to "Urgent")

/** Tenant "Report an issue" (Android V1 final gap-closure pass, WORKLOG.md this date, Phase 4) --
 * mirrors ReportPaymentScreen's shape exactly. No photo/file attachment field: the backend
 * doesn't accept one yet for tenant-submitted tickets (see MaintenanceRepository's doc comment) --
 * not omitted by oversight. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateMaintenanceTicketScreen(
    onSubmitted: () -> Unit,
    onCancel: () -> Unit,
    viewModel: CreateMaintenanceTicketViewModel = hiltViewModel(),
) {
    val formState by viewModel.formState.collectAsState()

    LaunchedEffect(formState.submitted) {
        if (formState.submitted) onSubmitted()
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Report an issue") }) },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            val errorMessage = formState.error
            if (errorMessage != null) {
                Text(errorMessage, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 12.dp))
            }

            OutlinedTextField(
                value = formState.summary,
                onValueChange = viewModel::setSummary,
                label = { Text("What's wrong?") },
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = formState.description,
                onValueChange = viewModel::setDescription,
                label = { Text("More detail (optional)") },
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                minLines = 3,
            )

            Text(
                "Priority",
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(top = 16.dp, bottom = 4.dp),
            )
            Column(Modifier.selectableGroup()) {
                PRIORITIES.forEach { (value, label) ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .selectable(
                                selected = formState.priority == value,
                                onClick = { viewModel.setPriority(value) },
                                role = Role.RadioButton,
                            ),
                    ) {
                        RadioButton(selected = formState.priority == value, onClick = null)
                        Text(label, modifier = Modifier.padding(start = 8.dp).wrapContentHeight())
                    }
                }
            }

            Row(modifier = Modifier.padding(top = 24.dp)) {
                Button(onClick = viewModel::submit, enabled = !formState.submitting) {
                    Text(if (formState.submitting) "Submitting…" else "Submit")
                }
                TextButton(onClick = onCancel, modifier = Modifier.padding(start = 8.dp)) {
                    Text("Cancel")
                }
            }
        }
    }
}
