package za.co.proplyst.app.ui.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.BuildConfig
import za.co.proplyst.app.ui.biometric.BiometricAvailability
import za.co.proplyst.app.ui.biometric.checkBiometricAvailability

/** Account/Settings (auth/session hardening pass, WORKLOG.md this date) -- the app's one and only
 * sign-out entry point (see AccountViewModel's own comment for why this was a real, disclosed
 * gap, not a deliberate omission), plus the biometric-lock toggle NATIVE_ANDROID_SPEC.md §12
 * explicitly calls for ("configurable in Settings"). Reached from a person icon in the Owner/
 * Tenant Alerts tab's TopAppBar, alongside the existing notification-settings gear --
 * deliberately not a new bottom-nav tab (OwnerRootScreen/TenantRootScreen already disclose a P2
 * tab-count concern; this keeps that unchanged). Confirmation dialog before the actual sign-out
 * call -- this is a destructive-feeling action from the user's point of view (loses their place
 * in the app) even though it's technically safe/reversible (sign back in). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(
    onBack: () -> Unit,
    onMyLeaseClick: (() -> Unit)? = null,
    viewModel: AccountViewModel = hiltViewModel(),
) {
    val signingOut by viewModel.signingOut.collectAsState()
    val biometricLockEnabled by viewModel.biometricLockEnabled.collectAsState()
    val context = LocalContext.current
    var showSignOutConfirm by remember { mutableStateOf(false) }
    var showUnavailableDialog by remember { mutableStateOf<BiometricAvailability?>(null) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Account") }) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Proplyst", style = MaterialTheme.typography.titleLarge)
            Text(
                "Version ${BuildConfig.VERSION_NAME}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (onMyLeaseClick != null) {
                HorizontalDivider()
                OutlinedButton(onClick = onMyLeaseClick, modifier = Modifier.fillMaxWidth()) {
                    Text("My lease")
                }
            }

            HorizontalDivider()

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column {
                    Text("Biometric app lock", style = MaterialTheme.typography.bodyLarge)
                    Text(
                        "Require fingerprint, face, or device PIN to open the app",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = biometricLockEnabled,
                    onCheckedChange = { turningOn ->
                        if (turningOn) {
                            // Never let the toggle turn on if it could never actually gate
                            // anything -- confirm real hardware/enrollment first rather than
                            // silently persisting a setting that would trap nobody (no biometric
                            // check is possible) or, worse, appear enabled while doing nothing.
                            val availability = checkBiometricAvailability(context)
                            if (availability == BiometricAvailability.AVAILABLE) {
                                viewModel.setBiometricLockEnabled(true)
                            } else {
                                showUnavailableDialog = availability
                            }
                        } else {
                            viewModel.setBiometricLockEnabled(false)
                        }
                    },
                )
            }

            HorizontalDivider()

            if (signingOut) {
                CircularProgressIndicator()
            } else {
                Button(
                    onClick = { showSignOutConfirm = true },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Sign out")
                }
            }
            OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
                Text("Back")
            }
        }
    }

    if (showSignOutConfirm) {
        AlertDialog(
            onDismissRequest = { showSignOutConfirm = false },
            title = { Text("Sign out?") },
            text = { Text("You'll need to sign in again to access your account.") },
            confirmButton = {
                TextButton(onClick = {
                    showSignOutConfirm = false
                    viewModel.signOut()
                }) {
                    Text("Sign out")
                }
            },
            dismissButton = {
                TextButton(onClick = { showSignOutConfirm = false }) {
                    Text("Cancel")
                }
            },
        )
    }

    showUnavailableDialog?.let { availability ->
        AlertDialog(
            onDismissRequest = { showUnavailableDialog = null },
            title = { Text("Biometric lock unavailable") },
            text = {
                Text(
                    when (availability) {
                        BiometricAvailability.NO_HARDWARE ->
                            "This device doesn't support fingerprint, face, or PIN unlock."
                        BiometricAvailability.NOT_ENROLLED ->
                            "Set up a fingerprint, face, or screen lock in your device settings first, then try again."
                        else -> "Biometric lock isn't available on this device right now."
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = { showUnavailableDialog = null }) {
                    Text("OK")
                }
            },
        )
    }
}
