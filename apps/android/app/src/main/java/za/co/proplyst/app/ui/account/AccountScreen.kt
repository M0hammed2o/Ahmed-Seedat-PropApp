package za.co.proplyst.app.ui.account

import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.ui.biometric.BiometricAvailability
import za.co.proplyst.app.ui.biometric.checkBiometricAvailability
import za.co.proplyst.app.ui.common.navyHeaderGlow
import za.co.proplyst.app.ui.theme.ProplystPillShape
import za.co.proplyst.app.ui.theme.ProplystTheme

/**
 * Settings › Security (fidelity audit §6, `B-Auth` `settings-*` states, platform=android) --
 * navy eyebrow header, account card (identity + Lock now + Sign out), fingerprint card with the
 * 50×30 switch and INLINE unavailable/not-enrolled states (replacing the old AlertDialogs), the
 * bottom-sheet sign-out confirmation, and the "Fingerprint unlock is on" toast. Security
 * semantics unchanged: the toggle still only ever flips [za.co.proplyst.app.data.biometric
 * .BiometricLockPreferences], and sign-out still runs the same [AccountViewModel.signOut] path.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(
    onBack: () -> Unit,
    onMyLeaseClick: (() -> Unit)? = null,
    viewModel: AccountViewModel = hiltViewModel(),
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val signingOut by viewModel.signingOut.collectAsState()
    val biometricLockEnabled by viewModel.biometricLockEnabled.collectAsState()
    val context = LocalContext.current
    var availability by remember { mutableStateOf(checkBiometricAvailability(context)) }
    var showSignOutSheet by remember { mutableStateOf(false) }
    var showEnabledToast by remember { mutableStateOf(false) }

    Box(modifier = Modifier.fillMaxSize().background(colors.background)) {
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            // ---- Navy header ----
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.navy)
                    .navyHeaderGlow()
                    .statusBarsPadding()
                    .padding(start = 8.dp, end = 20.dp, bottom = 22.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Color.White)
                    }
                }
                Column(modifier = Modifier.padding(start = 12.dp)) {
                    Text("Settings", style = type.meta, color = colors.navySecondaryOn)
                    Text("Security", style = type.settingsTitle, color = Color.White, modifier = Modifier.padding(top = 2.dp))
                }
            }

            Column(modifier = Modifier.padding(horizontal = 20.dp)) {
                Spacer(modifier = Modifier.height(16.dp))

                // ---- Account card ----
                SettingsCard {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp, horizontal = 16.dp),
                    ) {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier.size(40.dp).background(colors.primary, CircleShape),
                        ) {
                            Text(
                                viewModel.accountEmail?.firstOrNull()?.uppercase() ?: "•",
                                style = type.captionEmphasis.copy(fontWeight = FontWeight.Bold),
                                color = Color.White,
                            )
                        }
                        Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                            Text(
                                viewModel.accountEmail ?: "Signed in",
                                style = type.cardTitle,
                                color = colors.textPrimary,
                            )
                            val role = viewModel.roleLabel()
                            if (role.isNotEmpty()) {
                                Text(role, style = type.meta, color = colors.textSecondary, modifier = Modifier.padding(top = 2.dp))
                            }
                        }
                    }
                    CardDivider()
                    if (onMyLeaseClick != null) {
                        SettingsRow(
                            icon = { Icon(Icons.Outlined.Home, contentDescription = null, tint = colors.primary, modifier = Modifier.size(20.dp)) },
                            iconTint = colors.blueTint,
                            title = "My lease",
                            titleColor = colors.textPrimary,
                            onClick = onMyLeaseClick,
                        )
                        CardDivider()
                    }
                    SettingsRow(
                        icon = { Icon(Icons.Outlined.Lock, contentDescription = null, tint = if (biometricLockEnabled) colors.primary else colors.textTertiary, modifier = Modifier.size(20.dp)) },
                        iconTint = if (biometricLockEnabled) colors.blueTint else colors.divider,
                        title = "Lock Proplyst now",
                        titleColor = if (biometricLockEnabled) colors.textPrimary else colors.textPrimary.copy(alpha = 0.45f),
                        onClick = if (biometricLockEnabled) ({ viewModel.lockNow() }) else null,
                    )
                    CardDivider()
                    if (signingOut) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxWidth().padding(14.dp)) {
                            CircularProgressIndicator(modifier = Modifier.size(22.dp))
                        }
                    } else {
                        SettingsRow(
                            icon = { Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, tint = colors.criticalDeep, modifier = Modifier.size(20.dp)) },
                            iconTint = colors.criticalBgAlt,
                            title = "Sign out",
                            titleColor = colors.criticalDeep,
                            onClick = { showSignOutSheet = true },
                        )
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                // ---- Fingerprint card ----
                SettingsCard {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp, horizontal = 16.dp),
                    ) {
                        val glyphOn = biometricLockEnabled && availability == BiometricAvailability.AVAILABLE
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .size(40.dp)
                                .background(if (glyphOn) colors.blueTint else colors.divider, RoundedCornerShape(12.dp)),
                        ) {
                            Icon(
                                Icons.Filled.Fingerprint,
                                contentDescription = null,
                                tint = if (glyphOn) colors.primary else colors.textTertiary,
                                modifier = Modifier.size(22.dp),
                            )
                        }
                        Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                            Text("Fingerprint unlock", style = type.cardTitle, color = colors.textPrimary)
                            Text(
                                when {
                                    availability == BiometricAvailability.NO_HARDWARE ->
                                        "This device doesn't support biometric unlock."
                                    availability == BiometricAvailability.NOT_ENROLLED ->
                                        "Fingerprint is not set up on this device."
                                    biometricLockEnabled -> "Unlocks Proplyst on this phone."
                                    else -> "Off. Use your password each time."
                                },
                                style = type.meta,
                                color = colors.textSecondary,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                        ProplystSwitch(
                            checked = biometricLockEnabled && availability == BiometricAvailability.AVAILABLE,
                            enabled = availability == BiometricAvailability.AVAILABLE,
                            onCheckedChange = { turningOn ->
                                availability = checkBiometricAvailability(context)
                                if (availability != BiometricAvailability.AVAILABLE) return@ProplystSwitch
                                viewModel.setBiometricLockEnabled(turningOn)
                                if (turningOn) showEnabledToast = true
                            },
                        )
                    }
                    if (availability == BiometricAvailability.NOT_ENROLLED) {
                        CardDivider()
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                                        Intent(Settings.ACTION_BIOMETRIC_ENROLL)
                                    } else {
                                        Intent(Settings.ACTION_SECURITY_SETTINGS)
                                    }
                                    runCatching { context.startActivity(intent) }
                                    availability = checkBiometricAvailability(context)
                                }
                                .padding(vertical = 12.dp, horizontal = 16.dp),
                        ) {
                            Text(
                                "Set up Fingerprint on this device first.",
                                style = type.meta,
                                color = colors.textSecondary,
                                modifier = Modifier.weight(1f),
                            )
                            Text("Open device settings", style = type.captionEmphasis.copy(fontWeight = FontWeight.Bold), color = colors.primary)
                        }
                    }
                }

                Text(
                    "Fingerprint unlocks the app on this device only. Your Proplyst session still expires and will ask for your password.",
                    style = type.meta,
                    color = colors.textTertiary,
                    modifier = Modifier.padding(top = 12.dp, start = 4.dp, end = 4.dp),
                )

                Spacer(modifier = Modifier.height(48.dp))
            }
        }

        // "Fingerprint unlock is on" toast, overlapping the header (audit §6).
        if (showEnabledToast) {
            Surface(
                color = colors.navy,
                shape = ProplystPillShape,
                shadowElevation = 8.dp,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .statusBarsPadding()
                    .offset(y = 96.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = colors.primaryLightOnNavy, modifier = Modifier.size(16.dp))
                    Text("Fingerprint unlock is on", style = type.captionEmphasis, color = Color.White, modifier = Modifier.padding(start = 8.dp))
                }
            }
        }
    }

    if (showSignOutSheet) {
        ModalBottomSheet(
            onDismissRequest = { showSignOutSheet = false },
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
            containerColor = colors.surface,
            scrimColor = colors.navy.copy(alpha = 0.55f),
            dragHandle = {
                Box(
                    modifier = Modifier
                        .padding(top = 12.dp, bottom = 4.dp)
                        .size(width = 40.dp, height = 4.dp)
                        .background(colors.border, RoundedCornerShape(2.dp)),
                )
            },
        ) {
            Column(modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 32.dp)) {
                Text("Sign out of Proplyst?", style = type.settingsTitle.copy(fontSize = 20.sp, lineHeight = 24.sp), color = colors.textPrimary)
                Text(
                    "You'll need your password next time. Fingerprint unlock on this device will be turned off.",
                    style = type.body,
                    color = colors.textSecondary,
                    modifier = Modifier.padding(top = 8.dp),
                )
                Spacer(modifier = Modifier.height(20.dp))
                Button(
                    onClick = {
                        showSignOutSheet = false
                        viewModel.setBiometricLockEnabled(false)
                        viewModel.signOut()
                    },
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = colors.critical, contentColor = Color.White),
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) {
                    Text("Sign out", style = type.button)
                }
                Spacer(modifier = Modifier.height(10.dp))
                OutlinedButton(
                    onClick = { showSignOutSheet = false },
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                ) {
                    Text("Cancel", style = type.buttonSecondary)
                }
            }
        }
    }
}

@Composable
private fun SettingsCard(content: @Composable () -> Unit) {
    Surface(
        color = ProplystTheme.colors.surface,
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier
            .fillMaxWidth()
            .shadow(
                1.dp,
                RoundedCornerShape(18.dp),
                ambientColor = ProplystTheme.colors.navyText.copy(alpha = 0.10f),
                spotColor = ProplystTheme.colors.navyText.copy(alpha = 0.10f),
            ),
    ) {
        Column { content() }
    }
}

@Composable
private fun CardDivider() {
    Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(ProplystTheme.colors.divider))
}

@Composable
private fun SettingsRow(
    icon: @Composable () -> Unit,
    iconTint: Color,
    title: String,
    titleColor: Color,
    onClick: (() -> Unit)?,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(vertical = 14.dp, horizontal = 16.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.size(40.dp).background(iconTint, RoundedCornerShape(12.dp)),
        ) {
            icon()
        }
        Text(
            title,
            style = ProplystTheme.type.cardTitle,
            color = titleColor,
            modifier = Modifier.padding(start = 12.dp).weight(1f),
        )
    }
}

/** 50×30 switch per the audit's exact spec (`#1B6BF2` on / `#D1D8E0` off, 24 dp knob, disabled at
 * 50 % opacity) -- M3's Switch is 52×32 with its own state layers; this tiny custom one matches
 * the design instead. */
@Composable
private fun ProplystSwitch(
    checked: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    val trackColor = if (checked) ProplystTheme.colors.primary else Color(0xFFD1D8E0)
    val knobOffset by animateDpAsState(targetValue = if (checked) 23.dp else 3.dp, label = "switch-knob")
    Box(
        contentAlignment = Alignment.CenterStart,
        modifier = Modifier
            .size(width = 50.dp, height = 30.dp)
            .background(trackColor.copy(alpha = if (enabled) 1f else 0.5f), ProplystPillShape)
            .clickable(enabled = enabled) { onCheckedChange(!checked) },
    ) {
        Box(
            modifier = Modifier
                .offset(x = knobOffset)
                .size(24.dp)
                .background(Color.White, CircleShape),
        )
    }
}
