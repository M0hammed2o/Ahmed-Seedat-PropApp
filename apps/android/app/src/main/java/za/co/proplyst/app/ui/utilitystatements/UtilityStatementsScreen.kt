package za.co.proplyst.app.ui.utilitystatements

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.utilitystatements.UtilityStatement
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView
import za.co.proplyst.app.ui.common.ProplystListPadding
import za.co.proplyst.app.ui.common.ProplystListSpacing
import za.co.proplyst.app.ui.common.ProplystScreenScaffold
import za.co.proplyst.app.ui.common.formatCurrency
import za.co.proplyst.app.ui.theme.ProplystTheme

/** Tenant "Utility statements" (hybrid utilities, docs/HYBRID_UTILITIES_ARCHITECTURE.md §F). Read-only: only
 * statements the landlord approved are returned by the server (RLS), and every figure -- readings, consumption,
 * tariff, totals -- is the server's snapshot. Utility charges themselves appear on the tenant's invoices. */
@Composable
fun UtilityStatementsScreen(viewModel: UtilityStatementsViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val expandedId by viewModel.expandedId.collectAsState()

    ProplystScreenScaffold(title = "Utility statements", eyebrow = "My tenancy") { padding ->
        when (val state = uiState) {
            is UtilityStatementsUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is UtilityStatementsUiState.Empty -> EmptyStateView(
                title = "No utility statements yet",
                description = "Statements appear here once your landlord or agent has reviewed and approved them.",
                modifier = Modifier.padding(padding),
            )
            is UtilityStatementsUiState.Error -> ErrorStateView(message = state.message, onRetry = viewModel::load, modifier = Modifier.padding(padding))
            is UtilityStatementsUiState.Loaded -> LazyColumn(
                modifier = Modifier.padding(padding).background(ProplystTheme.colors.background),
                contentPadding = ProplystListPadding,
                verticalArrangement = ProplystListSpacing,
            ) {
                items(state.statements, key = { it.id }) { statement ->
                    StatementCard(statement, expanded = expandedId == statement.id, onClick = { viewModel.toggle(statement.id) })
                }
            }
        }
    }
}

@Composable
private fun StatementCard(statement: UtilityStatement, expanded: Boolean, onClick: () -> Unit) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Surface(color = colors.surface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("${statement.periodStart} to ${statement.periodEnd}", style = type.cardTitle.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                    Text(
                        listOfNotNull(statement.unitLabel, statement.propertyName).joinToString(", "),
                        style = type.caption,
                        color = colors.textSecondary,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                Column {
                    Text("R ${formatCurrency(statement.total)}", style = type.cardTitle.copy(fontWeight = FontWeight.Bold), color = colors.textPrimary)
                    statement.vat?.takeIf { it > 0 }?.let { Text("incl. VAT R ${formatCurrency(it)}", style = type.microLabel, color = colors.textTertiary) }
                }
            }
            if (expanded) {
                Spacer(Modifier.height(12.dp))
                statement.lines.forEach { line ->
                    Column(modifier = Modifier.padding(bottom = 10.dp)) {
                        Text(line.description, style = type.captionEmphasis, color = colors.textPrimary)
                        Text(line.segment, style = type.microLabel, color = colors.textTertiary)
                        if (line.opening != null || line.closing != null) {
                            Text("Readings ${line.opening?.let { "%.3f".format(it) } ?: "—"} → ${line.closing?.let { "%.3f".format(it) } ?: "—"} ${line.unit}", style = type.caption, color = colors.textSecondary)
                        }
                        Text(
                            "Used ${line.consumption?.let { "%.3f".format(it) } ?: "—"} ${line.unit}${if (line.isEstimated) " (estimated)" else ""}${line.tariff?.let { " · $it" } ?: ""}",
                            style = type.caption,
                            color = if (line.isEstimated) colors.warningDeep else colors.textSecondary,
                        )
                        if (line.creditApplied > 0) Text("Credit applied −R ${formatCurrency(line.creditApplied)}", style = type.caption, color = colors.successText)
                        Text("R ${formatCurrency(line.total)}", style = type.captionEmphasis, color = colors.textPrimary)
                    }
                }
                statement.notes.forEach { Text(it, style = type.microLabel, color = colors.textTertiary) }
            } else {
                Text("Tap for readings and charges", style = type.microLabel, color = colors.textTertiary, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
}
