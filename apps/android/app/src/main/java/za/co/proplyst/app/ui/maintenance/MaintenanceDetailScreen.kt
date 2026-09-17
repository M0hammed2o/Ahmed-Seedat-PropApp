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
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import za.co.proplyst.app.ui.common.ProplystDetailPadding
import za.co.proplyst.app.ui.common.ProplystListSpacing
import za.co.proplyst.app.ui.common.ProplystRecordCard
import za.co.proplyst.app.ui.common.ProplystSectionLabel
import za.co.proplyst.app.ui.common.StatusChip
import za.co.proplyst.app.ui.common.StatusTone
import za.co.proplyst.app.ui.common.relativeTimeLabel
import za.co.proplyst.app.ui.common.toneForStatus
import za.co.proplyst.app.ui.theme.ProplystTheme

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
            is MaintenanceDetailUiState.Loaded -> LazyColumn(
                modifier = Modifier.padding(padding).background(ProplystTheme.colors.background),
                contentPadding = ProplystDetailPadding,
                verticalArrangement = ProplystListSpacing,
            ) {
                item {
                    Surface(color = ProplystTheme.colors.surface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                state.ticket.summary,
                                style = ProplystTheme.type.settingsTitle,
                                color = ProplystTheme.colors.textPrimary,
                            )
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                modifier = Modifier.padding(top = 10.dp),
                            ) {
                                val priority = state.ticket.priority.replace('_', ' ')
                                val status = state.ticket.status.replace('_', ' ')
                                StatusChip(
                                    label = priority.replaceFirstChar { it.uppercase() },
                                    tone = when (priority.lowercase()) {
                                        "urgent", "high" -> StatusTone.CRITICAL
                                        "medium" -> StatusTone.WARNING
                                        else -> StatusTone.NEUTRAL
                                    },
                                )
                                StatusChip(label = status.replaceFirstChar { it.uppercase() }, tone = toneForStatus(status))
                            }
                            Text(
                                "Reported ${relativeTimeLabel(state.ticket.createdAt)}",
                                style = ProplystTheme.type.meta,
                                color = ProplystTheme.colors.textTertiary,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                            if (!state.ticket.description.isNullOrBlank()) {
                                Text(
                                    state.ticket.description,
                                    style = ProplystTheme.type.body,
                                    color = ProplystTheme.colors.textSecondary,
                                    modifier = Modifier.padding(top = 10.dp),
                                )
                            }
                        }
                    }
                }

                item {
                    Column {
                        ProplystSectionLabel("Photos & files")

                        if (uploadError != null) {
                            Surface(
                                color = ProplystTheme.colors.criticalBg,
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                            ) {
                                Text(
                                    uploadError.orEmpty(),
                                    style = ProplystTheme.type.body,
                                    color = ProplystTheme.colors.criticalDeep,
                                    modifier = Modifier.padding(12.dp),
                                )
                            }
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
                                CircularProgressIndicator(
                                    strokeWidth = 2.dp,
                                    color = ProplystTheme.colors.primary,
                                    modifier = Modifier.padding(end = 8.dp).size(16.dp),
                                )
                                Text("Uploading…", style = ProplystTheme.type.buttonSecondary)
                            } else {
                                Icon(Icons.Filled.AttachFile, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                                Text("Attach a photo or file", style = ProplystTheme.type.buttonSecondary)
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
                                    style = ProplystTheme.type.body,
                                    color = ProplystTheme.colors.textTertiary,
                                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
                                )
                            }
                        } else {
                            items(attachState.attachments, key = { it.id }) { attachment ->
                                AttachmentRow(attachment, onClick = { viewModel.openAttachment(attachment.id) })
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
    ProplystRecordCard(
        title = attachment.originalFileName ?: "Attachment",
        meta = attachment.documentType?.replace('_', ' ')?.replaceFirstChar { it.uppercase() },
        onClick = onClick,
    )
}



