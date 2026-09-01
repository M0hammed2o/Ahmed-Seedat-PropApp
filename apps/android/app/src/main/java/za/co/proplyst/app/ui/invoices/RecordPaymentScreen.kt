package za.co.proplyst.app.ui.invoices

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
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
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

// Matches invoicePaymentMethodSchema (packages/validation/src/accounting.ts) exactly -- the
// server rejects anything else with a 400, this app never sends a value outside this set.
private val PAYMENT_METHODS = listOf(
    "eft" to "EFT / bank transfer",
    "cash" to "Cash",
    "card" to "Card",
    "debit_order" to "Debit order",
    "bank_deposit" to "Bank deposit",
    "other" to "Other",
)
private val ISO_DATE_FORMAT = SimpleDateFormat("yyyy-MM-dd", Locale.US)

/** Owner/staff "Record payment" (Invoice V1 completion pass, WORKLOG.md this date) -- only ever
 * reached from an InvoiceDetailScreen that already gated the entry point on
 * `canRecordPayment` (see that ViewModel's own doc comment). Overpayment/allocation rules are
 * enforced server-side ONLY (`record_invoice_payment()`, no bypass parameter exists) -- this
 * screen submits the caller's own input as-is and shows whatever the server decides, including a
 * `would_overpay`/403 rejection, never a locally pre-computed "this would overpay" check. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecordPaymentScreen(
    onSubmitted: () -> Unit,
    onCancel: () -> Unit,
    viewModel: RecordPaymentViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    var amount by remember { mutableStateOf("") }
    var method by remember { mutableStateOf(PAYMENT_METHODS.first().first) }
    var paidAt by remember { mutableStateOf("") }
    var reference by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var showDatePicker by remember { mutableStateOf(false) }
    var validationError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(uiState) {
        if (uiState == RecordPaymentUiState.Success) onSubmitted()
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Record payment") }) },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            val serverError = (uiState as? RecordPaymentUiState.Error)?.message
            (validationError ?: serverError)?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 12.dp))
            }

            OutlinedTextField(
                value = amount,
                onValueChange = { amount = it; validationError = null },
                label = { Text("Amount (R)") },
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
                                selected = method == value,
                                onClick = { method = value },
                                role = Role.RadioButton,
                            ),
                    ) {
                        RadioButton(selected = method == value, onClick = null)
                        Text(label, modifier = Modifier.padding(start = 8.dp).wrapContentHeight())
                    }
                }
            }

            OutlinedButton(
                onClick = { showDatePicker = true },
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            ) {
                Text(if (paidAt.isBlank()) "Select payment date" else paidAt)
            }

            OutlinedTextField(
                value = reference,
                onValueChange = { reference = it },
                label = { Text("Reference (optional)") },
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            )

            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                label = { Text("Notes (optional)") },
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            )

            Row(modifier = Modifier.padding(top = 24.dp)) {
                Button(
                    onClick = {
                        val parsedAmount = amount.toDoubleOrNull()
                        validationError = when {
                            parsedAmount == null || parsedAmount <= 0 -> "Enter a valid amount."
                            paidAt.isBlank() -> "Select a payment date."
                            else -> null
                        }
                        if (validationError == null && parsedAmount != null) {
                            viewModel.submit(
                                amount = parsedAmount,
                                paidAt = paidAt,
                                method = method,
                                reference = reference.ifBlank { null },
                                notes = notes.ifBlank { null },
                            )
                        }
                    },
                    enabled = uiState != RecordPaymentUiState.Submitting,
                ) {
                    Text(if (uiState == RecordPaymentUiState.Submitting) "Recording…" else "Record payment")
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
                        paidAt = ISO_DATE_FORMAT.format(Date(it))
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
