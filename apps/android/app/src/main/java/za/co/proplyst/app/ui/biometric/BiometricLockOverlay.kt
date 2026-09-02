package za.co.proplyst.app.ui.biometric

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.launch
import za.co.proplyst.app.R
import za.co.proplyst.app.ui.theme.ProplystTheme

/**
 * Lock screen for a returning user (fidelity audit §6, `B-Auth` `lock`/`lock-prompt`/
 * `lock-failed`, platform=android) -- full navy, white image wordmark, 120 dp glyph tile,
 * primary "Unlock with Fingerprint", outlined "Use password instead", "Sign out" footer link.
 * Success still only clears the local gate ([onUnlocked]); it never touches the session.
 * Auth/lock screens stay navy in both themes (audit §13).
 */
@Composable
fun BiometricLockOverlay(
    onUnlocked: () -> Unit,
    onUsePassword: () -> Unit,
    onSignOut: () -> Unit,
    accountEmail: String?,
) {
    val activity = LocalContext.current as? FragmentActivity
    val scope = rememberCoroutineScope()
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    var failed by remember { mutableStateOf(false) }
    var authenticating by remember { mutableStateOf(false) }

    fun attempt() {
        val act = activity ?: return
        if (authenticating) return
        authenticating = true
        scope.launch {
            when (authenticateWithBiometrics(act, "Unlock Proplyst", "Use your fingerprint to continue")) {
                is BiometricResult.Success -> onUnlocked()
                is BiometricResult.Cancelled, is BiometricResult.Failed -> failed = true
            }
            authenticating = false
        }
    }

    LaunchedEffect(Unit) { attempt() }

    Surface(modifier = Modifier.fillMaxSize(), color = colors.navy) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = 24.dp),
        ) {
            Image(
                painter = painterResource(R.drawable.proplyst_wordmark),
                contentDescription = "Proplyst",
                colorFilter = ColorFilter.tint(Color.White),
                modifier = Modifier.padding(top = 16.dp).height(20.dp),
            )
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
                modifier = Modifier.weight(1f),
            ) {
                val tileTint = if (failed) Color(0xFFDC2626).copy(alpha = 0.18f) else colors.primary.copy(alpha = 0.18f)
                val glyphTint = if (failed) Color(0xFFFCA5A5) else colors.primaryLightOnNavy
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.size(120.dp).background(tileTint, RoundedCornerShape(36.dp)),
                ) {
                    Icon(Icons.Filled.Fingerprint, contentDescription = null, tint = glyphTint, modifier = Modifier.size(56.dp))
                }
                Spacer(modifier = Modifier.height(26.dp))
                Text(
                    if (failed) "Fingerprint didn't recognise you" else "Welcome back",
                    style = type.pageTitle,
                    color = Color.White,
                    textAlign = TextAlign.Center,
                )
                if (!failed && accountEmail != null) {
                    Text(accountEmail, style = type.body, color = colors.navySecondaryOn, modifier = Modifier.padding(top = 8.dp))
                }
                Text(
                    if (failed) {
                        "Try again, or use your password to continue."
                    } else {
                        "Fingerprint keeps you signed in on this device."
                    },
                    style = type.body,
                    color = colors.navySecondaryOn,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            Button(
                onClick = { failed = false; attempt() },
                enabled = !authenticating,
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
                Text(if (failed) "Try again" else "Unlock with Fingerprint", style = type.button)
            }
            Spacer(modifier = Modifier.height(10.dp))
            OutlinedButton(
                onClick = onUsePassword,
                shape = RoundedCornerShape(14.dp),
                border = BorderStroke(1.dp, Color.White.copy(alpha = 0.18f)),
                colors = ButtonDefaults.outlinedButtonColors(
                    containerColor = Color.White.copy(alpha = 0.06f),
                    contentColor = Color.White,
                ),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                Text("Use password instead", style = type.buttonSecondary)
            }
            Text(
                "Not you? Sign out",
                style = type.meta,
                color = colors.primaryLightOnNavy,
                modifier = Modifier
                    .padding(top = 14.dp, bottom = 36.dp)
                    .clickable(onClick = onSignOut),
            )
        }
    }
}
