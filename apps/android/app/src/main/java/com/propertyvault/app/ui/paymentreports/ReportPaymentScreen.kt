package com.propertyvault.app.ui.paymentreports

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val PAYMENT_METHODS = listOf("eft" to "EFT / bank transfer", "cash" to "Cash", "other" to "Other")
private val ISO_DATE_FORMAT = SimpleDateFormat("yyyy-MM-dd", Locale.US)

/** "Report a payment" (Android V1 commercial-launch pass, WORKLOG.md this date, Phase 4) --
 * mirrors the web app's /my-payments/report form exactly: amount, method, date, optional
 * proof-of-payment file, submit. Uses OpenDocument (not GetContent) so multiple real MIME types
 * (image/jpeg, image/png, application/pdf -- matching ALLOWED_MIME_TYPES server-side) can be
 * offered in one picker without a wildcard mismatch. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportPaymentScreen(
    onSubmitted: () -> Unit,
    onCancel: () -> Unit,
    viewModel: ReportPaymentViewModel = hiltViewModel(),
) {
    val formState by viewModel.formState.collectAsState()
    var showDatePicker by remember { mutableStateOf(false) }

    LaunchedEffect(formState.submitted) {
        if (formState.submitted) onSubmitted()
    }

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        viewModel.setProofUri(uri)
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Report a payment") }) },
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
                value = formState.amount,
                onValueChange = viewModel::setAmount,
                label = { Text("Amount paid (R)") },
                modifier = Modifier.fillMaxWidth(),
            )

            Text(
                "Payment method",
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(top = 16.dp, bottom = 4.dp),
            )
            Column(Modifier.selectableGroup()) {
                PAYMENT_METHODS.forEach { (value, label) ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .selectable(
                                selected = formState.paymentMethod == value,
                                onClick = { viewModel.setPaymentMethod(value) },
                                role = Role.RadioButton,
                            ),
                    ) {
                        RadioButton(selected = formState.paymentMethod == value, onClick = null)
                        Text(label, modifier = Modifier.padding(start = 8.dp).wrapContentHeight())
                    }
                }
            }

            OutlinedButton(
                onClick = { showDatePicker = true },
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            ) {
                Text(if (formState.paymentDate.isBlank()) "Select payment date" else formState.paymentDate)
            }

            OutlinedButton(
                onClick = { filePicker.launch(arrayOf("image/jpeg", "image/png", "application/pdf")) },
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            ) {
                Icon(Icons.Filled.AttachFile, contentDescription = null, modifier = Modifier.size(18.dp))
                Text(
                    if (formState.proofUri == null) "Attach proof of payment (optional)" else "Proof of payment attached",
                    modifier = Modifier.padding(start = 8.dp),
                )
            }

            Row(modifier = Modifier.padding(top = 24.dp)) {
                Button(onClick = viewModel::submit, enabled = !formState.submitting) {
                    Text(if (formState.submitting) "Submitting…" else "Report payment")
                }
                TextButton(onClick = onCancel, modifier = Modifier.padding(start = 8.dp)) {
                    Text("Cancel")
                }
            }
        }
    }

    if (showDatePicker) {
        val datePickerState = rememberDatePickerState()
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    datePickerState.selectedDateMillis?.let {
                        viewModel.setPaymentDate(ISO_DATE_FORMAT.format(Date(it)))
                    }
                    showDatePicker = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { showDatePicker = false }) { Text("Cancel") } },
        ) {
            DatePicker(state = datePickerState)
        }
    }
}
