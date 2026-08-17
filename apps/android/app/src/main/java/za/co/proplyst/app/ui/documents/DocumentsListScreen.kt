package za.co.proplyst.app.ui.documents

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
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

/** Tenant "Documents" (Android V1 final gap-closure pass, WORKLOG.md this date, Phase 5) --
 * RLS scopes the list to only documents explicitly tagged with this tenant's own lease (see
 * TenantDocumentsRepository's doc comment); opening a document fetches a fresh 5-minute signed
 * URL and hands it to the OS via ACTION_VIEW, same pattern as Phase 3's "view proof of payment,"
 * no download/FileProvider complexity. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DocumentsListScreen(viewModel: DocumentsViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val openError by viewModel.openError.collectAsState()
    val documentUrl by viewModel.documentUrl.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(documentUrl) {
        val url = documentUrl
        if (url != null) {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            viewModel.consumeDocumentUrl()
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Documents") }) },
    ) { padding ->
        when (val state = uiState) {
            is DocumentsUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is DocumentsUiState.Empty -> EmptyStateView(
                title = "No documents shared with you yet",
                modifier = Modifier.padding(padding),
            )
            is DocumentsUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is DocumentsUiState.Loaded -> LazyColumn(modifier = Modifier.padding(padding)) {
                if (openError != null) {
                    item {
                        Text(
                            openError.orEmpty(),
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(16.dp),
                        )
                    }
                }
                items(state.documents, key = { it.id }) { document ->
                    DocumentRow(document, onClick = { viewModel.openDocument(document.id) })
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun DocumentRow(document: TenantDocument, onClick: () -> Unit) {
    ListItem(
        leadingContent = { Icon(Icons.Filled.Description, contentDescription = null) },
        headlineContent = { Text(document.originalFileName ?: "Document") },
        supportingContent = document.documentType?.let { { Text(it.replace('_', ' ')) } },
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    )
}
