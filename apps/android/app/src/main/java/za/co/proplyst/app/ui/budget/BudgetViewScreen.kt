package za.co.proplyst.app.ui.budget

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.financials.AnnualBudget
import za.co.proplyst.app.ui.common.formatCurrency
import za.co.proplyst.app.ui.common.navyHeaderGlow
import za.co.proplyst.app.ui.theme.ProplystTheme

/** Owner Budget View (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §8, §9-E; Annual tab added in the Phase
 * A budget-hierarchy pass, WORKLOG.md this date). Category-line breakdown (budget_category_lines)
 * is still not shown -- unused server-side scaffolding, deliberately left as optional/future per
 * that same pass's own V1 scope decision; this screen shows the overall planned/actual/remaining/%
 * plus a Water/Electricity/Rates & taxes/Levies/Other split, the same figures Home's own Operating
 * Costs section shows. */
@Composable
fun BudgetViewScreen(
    onBack: () -> Unit,
    viewModel: BudgetViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type

    Column(modifier = Modifier.fillMaxSize().background(colors.background)) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.navy)
                .navyHeaderGlow()
                .statusBarsPadding()
                .padding(bottom = 16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp)) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back", tint = Color.White)
                }
                Text("Budget", style = type.settingsTitle, color = Color.White)
            }
            Row(modifier = Modifier.padding(top = 6.dp, start = 20.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HeaderChip("Whole portfolio", state.selectedPropertyId == null) { viewModel.selectProperty(null) }
                state.properties.forEach { property ->
                    HeaderChip(property.nickname, property.id == state.selectedPropertyId) { viewModel.selectProperty(property.id) }
                }
            }
            Row(modifier = Modifier.padding(top = 10.dp, start = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HeaderChip("Monthly", state.period == BudgetPeriod.MONTHLY) { viewModel.setPeriod(BudgetPeriod.MONTHLY) }
                HeaderChip("Annual", state.period == BudgetPeriod.ANNUAL) { viewModel.setPeriod(BudgetPeriod.ANNUAL) }
            }
        }

        when (state.period) {
            BudgetPeriod.MONTHLY -> MonthlyBudgetContent(state, colors, type)
            BudgetPeriod.ANNUAL -> AnnualBudgetContent(state, colors, type)
        }
    }
}

@Composable
private fun MonthlyBudgetContent(state: BudgetViewState, colors: za.co.proplyst.app.ui.theme.ProplystColorTokens, type: za.co.proplyst.app.ui.theme.ProplystTypeTokens) {
    when {
        state.loading -> CircularProgressIndicator(modifier = Modifier.padding(24.dp).size(24.dp))
        state.error != null -> Text(state.error, style = type.caption, color = colors.critical, modifier = Modifier.padding(20.dp))
        state.summary?.budgetPlanned == null -> Column(modifier = Modifier.padding(20.dp)) {
            Text(
                "No budget set for this month yet. Set one from Properties → Finances on the web app.",
                style = type.body,
                color = colors.textSecondary,
            )
        }
        else -> {
            val summary = state.summary
            val planned = summary.budgetPlanned ?: 0.0
            val pct = (summary.budgetUsedPercent ?: 0.0).coerceIn(0.0, 999.0)
            val barColor = when {
                pct >= 100.0 -> colors.critical
                pct >= 80.0 -> colors.warning
                else -> colors.primary
            }
            Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Surface(color = colors.surface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Text("R ${formatCurrency(summary.totalExpenses)} of R ${formatCurrency(planned)}", style = type.cardTitleLarge, color = colors.textPrimary)
                            Text("${"%.1f".format(pct)}%", style = type.cardTitleLarge.copy(fontWeight = FontWeight.Bold), color = barColor)
                        }
                        Spacer(Modifier.height(10.dp))
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                            ProgressBar(pct, barColor, colors.divider)
                        }
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            BudgetStat("Planned", planned)
                            BudgetStat("Actual", summary.totalExpenses)
                            BudgetStat("Remaining", summary.budgetRemaining ?: 0.0)
                        }
                    }
                }
                Surface(color = colors.surface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Expense breakdown this month", style = type.cardTitle.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                        Spacer(Modifier.height(10.dp))
                        BudgetBreakdownRow("Water", summary.waterExpense)
                        BudgetBreakdownRow("Electricity", summary.electricityExpense)
                        BudgetBreakdownRow("Rates & taxes", summary.ratesTaxesExpense)
                        BudgetBreakdownRow("Levies", summary.leviesExpense)
                        BudgetBreakdownRow("Other", summary.otherExpenses)
                    }
                }
            }
        }
    }
}

@Composable
private fun AnnualBudgetContent(state: BudgetViewState, colors: za.co.proplyst.app.ui.theme.ProplystColorTokens, type: za.co.proplyst.app.ui.theme.ProplystTypeTokens) {
    when {
        state.annualLoading -> CircularProgressIndicator(modifier = Modifier.padding(24.dp).size(24.dp))
        state.annualError != null -> Text(state.annualError, style = type.caption, color = colors.critical, modifier = Modifier.padding(20.dp))
        state.annualBudget == null || state.annualBudget.monthsPlanned == 0 -> Column(modifier = Modifier.padding(20.dp)) {
            Text(
                "No annual budget set for ${state.year} yet. Distribute one from Properties → Finances on the web app.",
                style = type.body,
                color = colors.textSecondary,
            )
        }
        else -> {
            val annual: AnnualBudget = state.annualBudget
            val pct = (annual.annualPercentUsed ?: 0.0).coerceIn(0.0, 999.0)
            val barColor = when {
                pct >= 100.0 -> colors.critical
                pct >= 80.0 -> colors.warning
                else -> colors.primary
            }
            Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Surface(color = colors.surface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Text("${annual.year} annual budget", style = type.cardTitle.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                            Text("${annual.monthsPlanned} / 12 months set", style = type.meta, color = colors.textSecondary)
                        }
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Text("R ${formatCurrency(annual.annualActual)} of R ${formatCurrency(annual.annualPlanned)}", style = type.cardTitleLarge, color = colors.textPrimary)
                            if (annual.annualPercentUsed != null) {
                                Text("${"%.1f".format(pct)}%", style = type.cardTitleLarge.copy(fontWeight = FontWeight.Bold), color = barColor)
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        if (annual.annualPercentUsed != null) {
                            ProgressBar(pct, barColor, colors.divider)
                            Spacer(Modifier.height(12.dp))
                        }
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            BudgetStat("Planned", annual.annualPlanned)
                            BudgetStat("Actual", annual.annualActual)
                            BudgetStat("Remaining", annual.annualRemaining)
                        }
                    }
                }
                Surface(color = colors.surface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Monthly progress", style = type.cardTitle.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                        Spacer(Modifier.height(10.dp))
                        annual.months.forEach { m ->
                            val label = java.time.LocalDate.parse(m.month).month.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.getDefault())
                            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                                Text(label, style = type.body, color = colors.textSecondary)
                                Text(
                                    if (m.plannedAmount == null) "—" else "R ${formatCurrency(m.actualAmount)} / R ${formatCurrency(m.plannedAmount)}",
                                    style = type.captionEmphasis,
                                    color = colors.textPrimary,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProgressBar(pct: Double, barColor: Color, trackColor: Color) {
    androidx.compose.foundation.layout.Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(8.dp)
            .clip(RoundedCornerShape(50))
            .background(trackColor),
    ) {
        androidx.compose.foundation.layout.Box(
            modifier = Modifier
                .fillMaxWidth((pct / 100.0).coerceIn(0.0, 1.0).toFloat())
                .height(8.dp)
                .background(barColor, RoundedCornerShape(50)),
        )
    }
}

@Composable
private fun BudgetStat(label: String, amount: Double) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Column {
        Text(label, style = type.meta, color = colors.textSecondary)
        Text("R ${formatCurrency(amount)}", style = type.captionEmphasis.copy(fontWeight = FontWeight.Bold), color = colors.textPrimary)
    }
}

@Composable
private fun BudgetBreakdownRow(label: String, amount: Double) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(label, style = type.body, color = colors.textSecondary)
        Text("R ${formatCurrency(amount)}", style = type.captionEmphasis, color = colors.textPrimary)
    }
}

@Composable
private fun HeaderChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Surface(
        color = if (selected) Color.White else Color.White.copy(alpha = 0.08f),
        shape = RoundedCornerShape(999.dp),
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Text(label, style = type.chipLabel, color = if (selected) colors.navy else Color.White, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
    }
}
