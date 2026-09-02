package za.co.proplyst.app.ui.auth

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.hilt.navigation.compose.hiltViewModel
import kotlinx.coroutines.launch
import za.co.proplyst.app.R
import za.co.proplyst.app.ui.biometric.BiometricAvailability
import za.co.proplyst.app.ui.biometric.BiometricResult
import za.co.proplyst.app.ui.biometric.authenticateWithBiometrics
import za.co.proplyst.app.ui.biometric.checkBiometricAvailability
import za.co.proplyst.app.ui.common.navyHeaderGlow
import za.co.proplyst.app.ui.common.ProplystTextField
import za.co.proplyst.app.ui.theme.ProplystPillShape
import za.co.proplyst.app.ui.theme.ProplystTheme

/**
 * Login (fidelity audit §1, `B-Auth.dc.html` platform=android) -- bottom-anchored navy hero with
 * the login glow, left-aligned 64×70 mark + title + tagline, radius-28 sheet with 50 dp Proplyst
 * fields on a 10 dp rhythm, kind-specific banners (invalid dot / network wifi-off + Retry /
 * expired blue clock), a disabled-at-45%-until-filled primary button, a badged Google boundary,
 * the signed-out toast, and -- in [returningUser] mode, reached from the lock screen's "Use
 * password instead" -- the returning-user fingerprint row. Biometric success here only calls
 * [onReturningUnlocked] (the local gate); it never substitutes for server sign-in.
 */
@Composable
fun SignInScreen(
    onSignedIn: () -> Unit,
    returningUser: Boolean = false,
    onReturningUnlocked: () -> Unit = {},
    viewModel: SignInViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    when (uiState.mode) {
        SignInMode.SIGN_IN -> SignInContent(
            uiState = uiState,
            returningUser = returningUser,
            storedEmail = viewModel.storedEmail,
            googleSignInAvailable = viewModel.googleSignInAvailable,
            onEmailChange = viewModel::onEmailChange,
            onPasswordChange = viewModel::onPasswordChange,
            onTogglePasswordVisibility = viewModel::onTogglePasswordVisibility,
            onForgotPasswordClick = viewModel::onForgotPasswordClick,
            onGoogleClick = viewModel::onGoogleSignInUnavailable,
            onRetry = viewModel::retry,
            onSignInClick = { viewModel.signIn(onSignedIn) },
            onReturningUnlocked = onReturningUnlocked,
        )
        SignInMode.FORGOT_PASSWORD, SignInMode.FORGOT_SENT -> ForgotPasswordContent(
            uiState = uiState,
            onEmailChange = viewModel::onForgotEmailChange,
            onBack = viewModel::onBackToSignIn,
            onSend = viewModel::sendPasswordReset,
        )
    }
}

@Composable
private fun SignInContent(
    uiState: SignInUiState,
    returningUser: Boolean,
    storedEmail: String?,
    googleSignInAvailable: Boolean,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onTogglePasswordVisibility: () -> Unit,
    onForgotPasswordClick: () -> Unit,
    onGoogleClick: () -> Unit,
    onRetry: () -> Unit,
    onSignInClick: () -> Unit,
    onReturningUnlocked: () -> Unit,
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val context = LocalContext.current
    val biometricAvailable = remember { checkBiometricAvailability(context) == BiometricAvailability.AVAILABLE }
    val expired = uiState.errorKind == SignInErrorKind.SESSION_EXPIRED
    val fieldsFilled = uiState.email.isNotBlank() && uiState.password.isNotBlank()

    val title = when {
        expired -> "Session expired"
        returningUser -> "Welcome back"
        else -> "Welcome to Proplyst"
    }
    val subtitle = if (expired) "For your security, please sign in again." else "Property intelligence simplified."

    Column(modifier = Modifier.fillMaxSize().background(ProplystTheme.colors.navy).imePadding()) {
        // ---- Navy hero: takes all free height, content bottom-anchored (audit §1) ----
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .navyHeaderGlow(login = true)
                .statusBarsPadding(),
        ) {
            if (uiState.showSignedOutToast) {
                Surface(
                    color = Color.White.copy(alpha = 0.10f),
                    border = BorderStroke(1.dp, Color.White.copy(alpha = 0.14f)),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                        Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = colors.primaryLightOnNavy, modifier = Modifier.size(16.dp))
                        Text("You've been signed out", style = type.captionEmphasis, color = Color.White, modifier = Modifier.padding(start = 8.dp))
                    }
                }
            }
            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(start = 24.dp, end = 24.dp, bottom = 20.dp),
            ) {
                Image(
                    painter = painterResource(R.drawable.proplyst_logo_mark),
                    contentDescription = "Proplyst",
                    modifier = Modifier.size(width = 64.dp, height = 70.dp),
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(title, style = type.screenTitle, color = Color.White)
                Text(subtitle, style = type.body, color = colors.navySecondaryOn, modifier = Modifier.padding(top = 6.dp))
            }
        }
        // ---- Sheet ----
        Surface(
            color = colors.surface,
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier
                    .padding(top = 22.dp, start = 24.dp, end = 24.dp, bottom = 30.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                if (expired && uiState.errorMessage != null) {
                    ExpiredBanner(message = uiState.errorMessage)
                }
                ProplystTextField(
                    value = uiState.email,
                    onValueChange = onEmailChange,
                    label = "Email",
                    placeholder = "you@example.com",
                    enabled = !uiState.isSubmitting,
                )
                ProplystTextField(
                    value = uiState.password,
                    onValueChange = onPasswordChange,
                    label = "Password",
                    placeholder = "••••••••",
                    enabled = !uiState.isSubmitting,
                    error = uiState.errorKind == SignInErrorKind.INVALID_CREDENTIALS,
                    visualTransformation = if (uiState.showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = onTogglePasswordVisibility) {
                            Icon(
                                if (uiState.showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                contentDescription = if (uiState.showPassword) "Hide password" else "Show password",
                                tint = colors.textTertiary,
                            )
                        }
                    },
                )
                if (!expired && uiState.errorMessage != null) {
                    ErrorBanner(
                        message = uiState.errorMessage,
                        kind = uiState.errorKind ?: SignInErrorKind.GENERIC,
                        onRetry = onRetry,
                    )
                }
                Text(
                    "Forgot password?",
                    style = type.captionEmphasis,
                    color = colors.primary,
                    modifier = Modifier
                        .align(Alignment.End)
                        .height(20.dp)
                        .clickable(onClick = onForgotPasswordClick),
                )
                Button(
                    onClick = onSignInClick,
                    enabled = fieldsFilled && !uiState.isSubmitting,
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = colors.primary,
                        contentColor = Color.White,
                        disabledContainerColor = colors.primary.copy(alpha = 0.45f),
                        disabledContentColor = Color.White,
                    ),
                    modifier = Modifier.fillMaxWidth().height(54.dp),
                ) {
                    if (uiState.isSubmitting) {
                        CircularProgressIndicator(
                            color = Color.White,
                            trackColor = Color.White.copy(alpha = 0.4f),
                            strokeWidth = 2.5.dp,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                    }
                    Text(if (uiState.isSubmitting) "Signing in…" else "Sign in", style = type.button)
                }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 2.dp)) {
                    HairlineDivider(Modifier.weight(1f))
                    Text("or continue with", style = type.meta, color = colors.textTertiary, modifier = Modifier.padding(horizontal = 10.dp))
                    HairlineDivider(Modifier.weight(1f))
                }
                OutlinedButton(
                    onClick = onGoogleClick,
                    shape = RoundedCornerShape(14.dp),
                    border = BorderStroke(1.dp, colors.border),
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                ) {
                    Surface(shape = CircleShape, color = Color.White, border = BorderStroke(1.dp, colors.border), modifier = Modifier.size(20.dp)) {
                        Box(contentAlignment = Alignment.Center) {
                            Text("G", style = type.meta.copy(fontWeight = FontWeight.ExtraBold), color = colors.primary)
                        }
                    }
                    Spacer(modifier = Modifier.width(10.dp))
                    Text("Continue with Google", style = type.buttonSecondary, color = colors.textPrimary)
                }
                if (!googleSignInAvailable) {
                    Text(
                        "Google Sign-In requires configuration by Proplyst before it's available.",
                        style = type.meta,
                        color = colors.textTertiary,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (returningUser) {
                    ReturningUserRow(email = storedEmail, onUnlocked = onReturningUnlocked)
                } else if (biometricAvailable) {
                    Text(
                        "After you sign in, you can turn on Fingerprint to unlock Proplyst faster on this device.",
                        style = type.meta,
                        color = colors.textTertiary,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun HairlineDivider(modifier: Modifier = Modifier) {
    Box(modifier = modifier.height(1.dp).background(ProplystTheme.colors.divider))
}

@Composable
private fun ExpiredBanner(message: String) {
    val colors = ProplystTheme.colors
    Surface(color = colors.blueTint, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Icon(Icons.Filled.Schedule, contentDescription = null, tint = colors.primaryDeep, modifier = Modifier.size(18.dp))
            Text(
                "$message Fingerprint unlock stays on for this device.",
                style = ProplystTheme.type.caption,
                color = colors.primaryDeep,
                modifier = Modifier.padding(start = 10.dp),
            )
        }
    }
}

@Composable
private fun ErrorBanner(message: String, kind: SignInErrorKind, onRetry: () -> Unit) {
    val colors = ProplystTheme.colors
    val (bg, border, text) = when (kind) {
        SignInErrorKind.NETWORK -> Triple(colors.networkBg, colors.networkBorder, colors.networkText)
        else -> Triple(colors.criticalBgAlt, colors.criticalBorder, colors.criticalDeep)
    }
    Surface(color = bg, shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, border), modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            if (kind == SignInErrorKind.NETWORK) {
                Icon(Icons.Filled.WifiOff, contentDescription = null, tint = text, modifier = Modifier.size(16.dp))
            } else {
                Box(modifier = Modifier.size(8.dp).background(colors.critical, CircleShape))
            }
            Text(message, style = ProplystTheme.type.caption, color = text, modifier = Modifier.padding(start = 10.dp).weight(1f))
            if (kind == SignInErrorKind.NETWORK) {
                Text(
                    "Retry",
                    style = ProplystTheme.type.captionEmphasis.copy(textDecoration = TextDecoration.Underline),
                    color = text,
                    modifier = Modifier.clickable(onClick = onRetry),
                )
            }
        }
    }
}

/** Returning-user fingerprint shortcut (audit §1) -- shown only in the lock screen's
 * "Use password instead" flow, where a locally stored session still exists. */
@Composable
private fun ReturningUserRow(email: String?, onUnlocked: () -> Unit) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val activity = LocalContext.current as? FragmentActivity
    val scope = rememberCoroutineScope()
    Column {
        HairlineDivider(Modifier.fillMaxWidth())
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Returning user", style = type.meta, color = colors.textTertiary)
                if (email != null) {
                    Text(email, style = type.captionEmphasis, color = colors.textPrimary, modifier = Modifier.padding(top = 2.dp))
                }
            }
            Surface(
                shape = ProplystPillShape,
                color = colors.inputSurface,
                border = BorderStroke(1.dp, colors.border),
                modifier = Modifier
                    .height(40.dp)
                    .clickable(enabled = activity != null) {
                        val act = activity ?: return@clickable
                        scope.launch {
                            val result = authenticateWithBiometrics(act, "Unlock Proplyst", "Use your fingerprint to continue")
                            if (result is BiometricResult.Success) onUnlocked()
                        }
                    },
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 14.dp)) {
                    Icon(Icons.Filled.Fingerprint, contentDescription = null, tint = colors.primary, modifier = Modifier.size(20.dp))
                    Text(
                        "Unlock with Fingerprint",
                        style = type.captionEmphasis.copy(fontWeight = FontWeight.Bold),
                        color = colors.textPrimary,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ForgotPasswordContent(
    uiState: SignInUiState,
    onEmailChange: (String) -> Unit,
    onBack: () -> Unit,
    onSend: () -> Unit,
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type

    if (uiState.mode == SignInMode.FORGOT_SENT) {
        // Sent state: full-navy centred screen (audit §1).
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.fillMaxSize().background(colors.navy).statusBarsPadding().padding(24.dp),
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier.size(84.dp).background(colors.primary.copy(alpha = 0.18f), CircleShape),
            ) {
                Icon(Icons.Filled.Email, contentDescription = null, tint = colors.primaryLightOnNavy, modifier = Modifier.size(36.dp))
            }
            Spacer(modifier = Modifier.height(20.dp))
            Text("Check your email", style = type.pageTitle, color = Color.White)
            Text(
                "If an account exists for that email, we've sent a link to reset your password.",
                style = type.body,
                color = colors.navySecondaryOn,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp),
            )
            Spacer(modifier = Modifier.height(28.dp))
            OutlinedButton(
                onClick = onBack,
                shape = RoundedCornerShape(14.dp),
                border = BorderStroke(1.dp, Color.White.copy(alpha = 0.18f)),
                colors = ButtonDefaults.outlinedButtonColors(containerColor = Color.White.copy(alpha = 0.08f), contentColor = Color.White),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                Text("Back to sign in", style = type.buttonSecondary)
            }
            Text(
                "Didn't get it? Resend",
                style = type.captionEmphasis,
                color = colors.primaryLightOnNavy,
                modifier = Modifier.padding(top = 14.dp).clickable(onClick = onSend),
            )
        }
        return
    }

    Column(modifier = Modifier.fillMaxSize().background(colors.navy).imePadding()) {
        Column(modifier = Modifier.weight(1f).fillMaxWidth().statusBarsPadding()) {
            Row(modifier = Modifier.padding(top = 8.dp, start = 12.dp)) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Color.White)
                }
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.Bottom) {
                Column(modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 20.dp)) {
                    Text("Reset your password", style = type.screenTitle, color = Color.White)
                    Text(
                        "Enter the email on your account and we'll send a reset link.",
                        style = type.body,
                        color = colors.navySecondaryOn,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }
        }
        Surface(
            color = colors.surface,
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.padding(top = 22.dp, start = 24.dp, end = 24.dp, bottom = 30.dp),
            ) {
                ProplystTextField(
                    value = uiState.forgotEmail,
                    onValueChange = onEmailChange,
                    label = "Email",
                    placeholder = "you@example.com",
                    enabled = !uiState.isSendingReset,
                )
                Button(
                    onClick = onSend,
                    enabled = !uiState.isSendingReset && uiState.forgotEmail.isNotBlank(),
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = colors.primary,
                        contentColor = Color.White,
                        disabledContainerColor = colors.primary.copy(alpha = 0.45f),
                        disabledContentColor = Color.White,
                    ),
                    modifier = Modifier.fillMaxWidth().height(54.dp),
                ) {
                    if (uiState.isSendingReset) {
                        CircularProgressIndicator(
                            color = Color.White,
                            trackColor = Color.White.copy(alpha = 0.4f),
                            strokeWidth = 2.5.dp,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                    }
                    Text(if (uiState.isSendingReset) "Sending…" else "Send reset link", style = type.button)
                }
                Text(
                    "Back to sign in",
                    style = type.captionEmphasis,
                    color = colors.primary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().clickable(onClick = onBack).padding(6.dp),
                )
            }
        }
    }
}
