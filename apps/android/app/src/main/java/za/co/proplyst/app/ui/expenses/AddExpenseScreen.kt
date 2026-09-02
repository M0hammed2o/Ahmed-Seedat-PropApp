package za.co.proplyst.app.ui.expenses

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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.expenses.SUGGESTED_EXPENSE_CATEGORIES
import za.co.proplyst.app.ui.common.EvidenceUploadPicker
import za.co.proplyst.app.ui.common.ProplystTextField
import za.co.proplyst.app.ui.common.navyHeaderGlow
import za.co.proplyst.app.ui.theme.ProplystTheme

/** Owner Add Expense (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §5, §9-C). Property required, unit
 * optional, category (suggested chips or free text -- the underlying model is free text, never a
 * locked enum), vendor deliberately not built this pass (see ExpensesRepository's own doc
 * comment), amount, reference, date, notes, evidence (Camera/Gallery/File). */
@Composable
fun AddExpenseScreen(
    onBack: () -> Unit,
    onSubmitted: () -> Unit,
    viewModel: AddExpenseViewModel = hiltViewModel(),
) {
    val state by viewModel.formState.collectAsState()
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type

    LaunchedEffect(state.submitted) {
        if (state.submitted) onSubmitted()
    }

    Column(modifier = Modifier.fillMaxSize().background(colors.background)) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.navy)
                .navyHeaderGlow()
                .statusBarsPadding()
                .padding(bottom = 20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp)) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back", tint = androidx.compose.ui.graphics.Color.White)
                }
                Text("Add expense", style = type.settingsTitle, color = androidx.compose.ui.graphics.Color.White)
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            (state.fieldError ?: state.submitError)?.let { message ->
                Surface(color = colors.criticalBg, shape = RoundedCornerShape(12.dp)) {
                    Text(message, style = type.caption, color = colors.criticalDeep, modifier = Modifier.padding(12.dp))
                }
            }

            Column {
                Text("Property", style = type.caption, color = colors.textSecondary)
                Spacer(Modifier.height(6.dp))
                if (state.propertiesLoading) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp))
                } else if (state.propertiesError != null) {
                    Text(state.propertiesError ?: "", style = type.caption, color = colors.critical)
                } else {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        state.properties.forEach { property ->
                            SelectableChip(
                                label = property.nickname,
                                selected = property.id == state.selectedPropertyId,
                                onClick = { viewModel.selectProperty(property.id) },
                            )
                        }
                    }
                }
            }

            if (state.units.isNotEmpty()) {
                Column {
                    Text("Unit (optional)", style = type.caption, color = colors.textSecondary)
                    Spacer(Modifier.height(6.dp))
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        SelectableChip(label = "Whole property", selected = state.selectedUnitId == null, onClick = { viewModel.selectUnit(null) })
                        state.units.forEach { unit ->
                            SelectableChip(
                                label = unit.unitLabel,
                                selected = unit.id == state.selectedUnitId,
                                onClick = { viewModel.selectUnit(unit.id) },
                            )
                        }
                    }
                }
            }

            Column {
                Text("Category", style = type.caption, color = colors.textSecondary)
                Spacer(Modifier.height(6.dp))
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    SUGGESTED_EXPENSE_CATEGORIES.forEach { suggestion ->
                        SelectableChip(
                            label = suggestion,
                            selected = state.category == suggestion,
                            onClick = { viewModel.setCategory(suggestion) },
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
                ProplystTextField(
                    value = state.category,
                    onValueChange = viewModel::setCategory,
                    label = "",
                    placeholder = "Or type a category",
                )
            }

            ProplystTextField(
                value = state.amount,
                onValueChange = viewModel::setAmount,
                label = "Amount (R)",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )

            ProplystTextField(
                value = state.invoiceDate,
                onValueChange = viewModel::setInvoiceDate,
                label = "Expense date (YYYY-MM-DD, optional)",
            )

            ProplystTextField(
                value = state.referenceNumber,
                onValueChange = viewModel::setReferenceNumber,
                label = "Reference number (optional)",
            )

            ProplystTextField(
                value = state.notes,
                onValueChange = viewModel::setNotes,
                label = "Notes (optional)",
            )

            EvidenceUploadPicker(
                pickedUri = state.evidenceUri,
                onPicked = viewModel::setEvidenceUri,
                label = "Receipt / evidence (optional)",
            )

            Button(
                onClick = viewModel::submit,
                enabled = !state.submitting,
                colors = ButtonDefaults.buttonColors(containerColor = colors.primary),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                if (state.submitting) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), color = androidx.compose.ui.graphics.Color.White, strokeWidth = 2.dp)
                } else {
                    Text("Save expense", style = type.button.copy(fontWeight = FontWeight.Bold), color = androidx.compose.ui.graphics.Color.White)
                }
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable
private fun SelectableChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Surface(
        color = if (selected) colors.primary else colors.inputSurface,
        shape = RoundedCornerShape(999.dp),
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Text(
            label,
            style = type.chipLabel,
            color = if (selected) androidx.compose.ui.graphics.Color.White else colors.textPrimary,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
        )
    }
}
