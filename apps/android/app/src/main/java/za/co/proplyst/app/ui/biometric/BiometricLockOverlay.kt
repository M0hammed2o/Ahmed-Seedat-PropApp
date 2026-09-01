package za.co.proplyst.app.ui.biometric

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.launch

/** The full-screen gate shown when [BiometricGateViewModel.locked] is true -- prompts
 * immediately on first composition, and again on a manual "Unlock" tap (e.g. after a cancel).
 * `LocalContext.current` is expected to resolve to a `FragmentActivity` (MainActivity extends it
 * specifically for this) -- if it somehow doesn't (a Preview host, say), this renders the locked
 * screen without ever being able to prompt, which is the safe failure direction for a lock
 * screen, not a crash. */
@Composable
fun BiometricLockOverlay(onUnlocked: () -> Unit) {
    val activity = LocalContext.current as? FragmentActivity
    val scope = rememberCoroutineScope()
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var authenticating by remember { mutableStateOf(false) }

    fun attempt() {
        val act = activity ?: return
        if (authenticating) return
        authenticating = true
        errorMessage = null
        scope.launch {
            when (val result = authenticateWithBiometrics(act, "Unlock Proplyst")) {
                is BiometricResult.Success -> onUnlocked()
                is BiometricResult.Cancelled -> Unit // stay locked -- the user can tap Unlock again
                is BiometricResult.Failed -> errorMessage = result.message
            }
            authenticating = false
        }
    }

    LaunchedEffect(Unit) { attempt() }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.fillMaxSize().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.Lock,
                contentDescription = null,
                modifier = Modifier.padding(bottom = 16.dp),
            )
            Text("Proplyst is locked", style = MaterialTheme.typography.titleLarge)
            if (errorMessage != null) {
                Text(
                    errorMessage.orEmpty(),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            Button(onClick = ::attempt, modifier = Modifier.padding(top = 24.dp)) {
                Text("Unlock")
            }
        }
    }
}
