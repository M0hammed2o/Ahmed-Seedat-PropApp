package za.co.proplyst.app.ui.maintenance

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.documents.TenantDocument
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView

/** Android V1 last local blocker pass (WORKLOG.md this date): attachments section added below
 * the ticket details. Opens files via OpenDocument (not GetContent), same reasoning
 * ReportPaymentScreen's own proof-of-payment picker uses -- lets several real MIME types
 * (image/jpeg, image/png, image/heic, application/pdf, matching ALLOWED_MIME_TYPES server-side)
 * be offered in one picker without a wildcard mismatch. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MaintenanceDetailScreen(
    onBack: () -> Unit,
    viewModel: MaintenanceDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val attachmentsState by viewModel.attachmentsState.collectAsState()
    val uploading by viewModel.uploading.collectAsState()
    val uploadError by viewModel.uploadError.collectAsState()
    val attachmentUrl by viewModel.attachmentUrl.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(attachmentUrl) {
        val url = attachmentUrl
        if (url != null) {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            viewModel.consumeAttachmentUrl()
        }
    }

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) viewModel.uploadAttachment(uri)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Ticket") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        when (val state = uiState) {
            is MaintenanceDetailUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is MaintenanceDetailUiState.NotFound -> EmptyStateView(
                title = "Ticket not found",
                modifier = Modifier.padding(padding),
            )
            is MaintenanceDetailUiState.Loaded -> LazyColumn(modifier = Modifier.padding(padding)) {
                item {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(state.ticket.summary, style = MaterialTheme.typography.headlineMedium)
                        DetailRow(label = "Priority", value = state.ticket.priority.replace('_', ' '))
                        DetailRow(label = "Status", value = state.ticket.status.replace('_', ' '))
                        if (!state.ticket.description.isNullOrBlank()) {
                            DetailRow(label = "Description", value = state.ticket.description)
                        }

                        Text(
                            "Photos & files",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.padding(top = 20.dp, bottom = 4.dp),
                        )

                        if (uploadError != null) {
                            Text(
                                uploadError.orEmpty(),
                                color = MaterialTheme.colorScheme.error,
                                modifier = Modifier.padding(bottom = 8.dp),
                            )
                        }

                        OutlinedButton(
                            onClick = {
                                filePicker.launch(
                                    arrayOf("image/jpeg", "image/png", "image/heic", "application/pdf"),
                                )
                            },
                            enabled = !uploading,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            if (uploading) {
                                CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
                                Text("Uploading…")
                            } else {
                                Icon(Icons.Filled.AttachFile, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                                Text("Attach a photo or file")
                            }
                        }
                    }
                }

                when (val attachState = attachmentsState) {
                    is AttachmentsUiState.Loading -> item {
                        LoadingView(modifier = Modifier.padding(16.dp))
                    }
                    is AttachmentsUiState.Error -> item {
                        ErrorStateView(
                            message = attachState.message,
                            onRetry = viewModel::loadAttachments,
                            modifier = Modifier.padding(16.dp),
                        )
                    }
                    is AttachmentsUiState.Loaded -> {
                        if (attachState.attachments.isEmpty()) {
                            item {
                                Text(
                                    "No photos or files attached yet.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                )
                            }
                        } else {
                            items(attachState.attachments, key = { it.id }) { attachment ->
                                AttachmentRow(attachment, onClick = { viewModel.openAttachment(attachment.id) })
                                HorizontalDivider()
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AttachmentRow(attachment: TenantDocument, onClick: () -> Unit) {
    ListItem(
        leadingContent = { Icon(Icons.Filled.Description, contentDescription = null) },
        headlineContent = { Text(attachment.originalFileName ?: "Attachment") },
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    )
}

@Composable
private fun DetailRow(label: String, value: String) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyLarge)
    }
}

