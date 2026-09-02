package za.co.proplyst.app.ui.biometric

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.launch
import za.co.proplyst.app.ui.theme.ProplystTheme

/**
 * One-time biometric offer after the first successful sign-in (fidelity audit §6, `B-Auth`
 * `bio-offer`, platform=android). Enabling runs the REAL system prompt first ([
 * authenticateWithBiometrics]) and only then flips [za.co.proplyst.app.data.biometric
 * .BiometricLockPreferences] via [onEnabled] -- the offer never pretends the feature is on
 * without a passed check, and it never touches the server session either way.
 */
@Composable
fun BiometricOfferScreen(
    onEnabled: () -> Unit,
    onSkip: () -> Unit,
) {
    val activity = LocalContext.current as? FragmentActivity
    val scope = rememberCoroutineScope()
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    var prompting by remember { mutableStateOf(false) }

    Surface(modifier = Modifier.fillMaxSize(), color = colors.navy) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = 24.dp),
        ) {
            Surface(
                color = colors.primary.copy(alpha = 0.18f),
                shape = RoundedCornerShape(50),
                modifier = Modifier.align(Alignment.End).padding(top = 12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = colors.primaryLightOnNavy, modifier = Modifier.size(14.dp))
                    Text("Signed in", style = type.chipLabel, color = colors.primaryLightOnNavy, modifier = Modifier.padding(start = 6.dp))
                }
            }
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
                modifier = Modifier.weight(1f),
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.size(112.dp).background(colors.primary.copy(alpha = 0.18f), RoundedCornerShape(32.dp)),
                ) {
                    Icon(Icons.Filled.Fingerprint, contentDescription = null, tint = colors.primaryLightOnNavy, modifier = Modifier.size(56.dp))
                }
                Spacer(modifier = Modifier.height(24.dp))
                Text("Unlock faster next time", style = type.pageTitle, color = Color.White, textAlign = TextAlign.Center)
                Text(
                    "Fingerprint only unlocks the app on this device. Your Proplyst sign-in stays exactly as secure as it is now.",
                    style = type.body,
                    color = colors.navySecondaryOn,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
            Button(
                onClick = {
                    val act = activity ?: return@Button
                    if (prompting) return@Button
                    prompting = true
                    scope.launch {
                        val result = authenticateWithBiometrics(act, "Unlock Proplyst", "Use your fingerprint to continue")
                        prompting = false
                        if (result is BiometricResult.Success) onEnabled()
                        // Cancel/failure: stay on the offer, the user can retry or tap Not now.
                    }
                },
                enabled = !prompting,
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = colors.primary,
                    contentColor = Color.White,
                    disabledContainerColor = colors.primary.copy(alpha = 0.45f),
                    disabledContentColor = Color.White,
                ),
                modifier = Modifier.fillMaxWidth().height(54.dp),
            ) {
                Icon(Icons.Filled.Fingerprint, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("Enable Fingerprint", style = type.button)
            }
            TextButton(onClick = onSkip, modifier = Modifier.fillMaxWidth().height(50.dp)) {
                Text("Not now", style = type.buttonSecondary, color = Color.White)
            }
            Text(
                "You can change this any time in Settings › Security.",
                style = type.meta,
                color = colors.navyTertiaryOn,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp, bottom = 28.dp),
            )
        }
    }
}
