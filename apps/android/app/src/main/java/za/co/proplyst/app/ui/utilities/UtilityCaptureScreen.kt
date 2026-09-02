package za.co.proplyst.app.ui.utilities

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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.ui.common.EvidenceUploadPicker
import za.co.proplyst.app.ui.common.ProplystTextField
import za.co.proplyst.app.ui.common.navyHeaderGlow
import za.co.proplyst.app.ui.theme.ProplystTheme

/** Owner Utility Capture (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6, §9-D). */
@Composable
fun UtilityCaptureScreen(
    onBack: () -> Unit,
    onSubmitted: () -> Unit,
    viewModel: UtilityCaptureViewModel = hiltViewModel(),
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
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back", tint = Color.White)
                }
                Text("Utility reading", style = type.settingsTitle, color = Color.White)
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
                } else {
                    Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        state.properties.forEach { property ->
                            SelectableChip(property.nickname, property.id == state.selectedPropertyId) { viewModel.selectProperty(property.id) }
                        }
                    }
                }
            }

            if (state.units.isNotEmpty()) {
                Column {
                    Text("Unit (optional)", style = type.caption, color = colors.textSecondary)
                    Spacer(Modifier.height(6.dp))
                    Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SelectableChip("Whole property", state.selectedUnitId == null) { viewModel.selectUnit(null) }
                        state.units.forEach { unit ->
                            SelectableChip(unit.unitLabel, unit.id == state.selectedUnitId) { viewModel.selectUnit(unit.id) }
                        }
                    }
                }
            }

            Column {
                Text("Utility", style = type.caption, color = colors.textSecondary)
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SelectableChip("Water", state.utilityType == "water") { viewModel.selectUtilityType("water") }
                    SelectableChip("Electricity", state.utilityType == "electricity") { viewModel.selectUtilityType("electricity") }
                }
            }

            Column {
                Text("Meter", style = type.caption, color = colors.textSecondary)
                Spacer(Modifier.height(6.dp))
                when {
                    state.metersLoading -> CircularProgressIndicator(modifier = Modifier.size(20.dp))
                    state.filteredMeters.isEmpty() -> Surface(color = colors.inputSurface, shape = RoundedCornerShape(12.dp)) {
                        Text(
                            "No ${state.utilityType} meter is set up for this selection yet. Add one from Properties → Finances on the web app.",
                            style = type.caption,
                            color = colors.textSecondary,
                            modifier = Modifier.padding(12.dp),
                        )
                    }
                    else -> Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        state.filteredMeters.forEach { meter ->
                            SelectableChip(meter.meterNumber ?: meter.utilityType.replaceFirstChar { it.uppercase() }, meter.id == state.selectedMeterId) {
                                viewModel.selectMeter(meter.id)
                            }
                        }
                    }
                }
            }

            if (state.selectedMeterId != null) {
                Surface(color = colors.surface, shape = RoundedCornerShape(16.dp)) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Column {
                                Text("Previous reading", style = type.meta, color = colors.textSecondary)
                                Text(
                                    if (state.previousLoading) "…" else state.previousReading?.let { "%.1f %s".format(it, if (state.utilityType == "water") "L" else "kWh") } ?: "No previous reading",
                                    style = type.cardTitle.copy(fontWeight = FontWeight.SemiBold),
                                    color = colors.textPrimary,
                                )
                            }
                            if (state.enteredConsumption != null) {
                                Column(horizontalAlignment = Alignment.End) {
                                    Text("Consumption", style = type.meta, color = colors.textSecondary)
                                    Text(
                                        "%.1f %s".format(state.enteredConsumption, if (state.utilityType == "water") "L" else "kWh"),
                                        style = type.cardTitle.copy(fontWeight = FontWeight.Bold),
                                        color = if (state.readingIsLowerThanPrevious) colors.criticalDeep else colors.primary,
                                    )
                                }
                            }
                        }
                        if (state.readingIsLowerThanPrevious) {
                            Spacer(Modifier.height(8.dp))
                            Text(
                                "This reading is lower than the previous one. If the meter was reset or replaced, this is expected -- otherwise, please double-check the value before saving.",
                                style = type.caption,
                                color = colors.warningDeep,
                            )
                        }
                    }
                }
            }

            ProplystTextField(
                value = state.readingValue,
                onValueChange = viewModel::setReadingValue,
                label = "Current reading (${if (state.utilityType == "water") "L" else "kWh"})",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )

            ProplystTextField(
                value = state.readingDate,
                onValueChange = viewModel::setReadingDate,
                label = "Reading date (YYYY-MM-DD)",
            )

            ProplystTextField(
                value = state.notes,
                onValueChange = viewModel::setNotes,
                label = "Notes (optional)",
            )

            EvidenceUploadPicker(
                pickedUri = state.evidenceUri,
                onPicked = viewModel::setEvidenceUri,
                label = "Utility bill (optional)",
            )

            Button(
                onClick = viewModel::submit,
                enabled = !state.submitting && state.selectedMeterId != null,
                colors = ButtonDefaults.buttonColors(containerColor = colors.primary),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                if (state.submitting) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                } else {
                    Text("Save reading", style = type.button.copy(fontWeight = FontWeight.Bold), color = Color.White)
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
        Text(label, style = type.chipLabel, color = if (selected) Color.White else colors.textPrimary, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
    }
}
