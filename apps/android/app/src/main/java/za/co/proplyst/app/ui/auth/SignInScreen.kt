package za.co.proplyst.app.ui.auth

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.R
import za.co.proplyst.app.ui.theme.ProplystTheme

/**
 * Login (Proplyst Mobile Design System redesign pass, approved Navy Deck direction, design
 * handoff §"Sign-in screen layout") -- navy header with the real Proplyst mark, white sheet with
 * styled inputs, invalid/network error banners, "Forgot password?", primary Sign in, and a
 * "Continue with Google" boundary that is honest about configuration (spec §7: never pretends
 * success when no OAuth client ID is configured). No Apple button -- Android only, per spec §6.
 */
@Composable
fun SignInScreen(
    onSignedIn: () -> Unit,
    viewModel: SignInViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    when (uiState.mode) {
        SignInMode.SIGN_IN -> SignInContent(
            uiState = uiState,
            googleSignInAvailable = viewModel.googleSignInAvailable,
            onEmailChange = viewModel::onEmailChange,
            onPasswordChange = viewModel::onPasswordChange,
            onTogglePasswordVisibility = viewModel::onTogglePasswordVisibility,
            onForgotPasswordClick = viewModel::onForgotPasswordClick,
            onGoogleClick = viewModel::onGoogleSignInUnavailable,
            onSignInClick = { viewModel.signIn(onSignedIn) },
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
private fun NavyTop(content: @Composable ColumnScope.() -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.radialGradient(
                    colors = listOf(ProplystTheme.colors.primary.copy(alpha = 0.35f), Color.Transparent),
                    center = androidx.compose.ui.geometry.Offset(x = 900f, y = -100f),
                    radius = 700f,
                ),
            )
            .background(ProplystTheme.colors.navy)
            .statusBarsPadding()
            .padding(top = 24.dp, start = 24.dp, end = 24.dp, bottom = 32.dp),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth(), content = content)
    }
}

@Composable
private fun SignInContent(
    uiState: SignInUiState,
    googleSignInAvailable: Boolean,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onTogglePasswordVisibility: () -> Unit,
    onForgotPasswordClick: () -> Unit,
    onGoogleClick: () -> Unit,
    onSignInClick: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).verticalScroll(rememberScrollState())) {
        NavyTop {
            Image(painter = painterResource(R.drawable.proplyst_logo_mark), contentDescription = "Proplyst", modifier = Modifier.size(64.dp))
            Spacer(modifier = Modifier.height(16.dp))
            Text("Welcome to Proplyst", style = ProplystTheme.type.screenTitle, color = Color.White)
            Text(
                "Property intelligence simplified.",
                style = ProplystTheme.type.body,
                color = ProplystTheme.colors.navySecondaryOn,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(horizontal = 22.dp, vertical = 26.dp)) {
                if (uiState.errorMessage != null) {
                    ErrorBanner(message = uiState.errorMessage, kind = uiState.errorKind ?: SignInErrorKind.GENERIC)
                    Spacer(modifier = Modifier.height(14.dp))
                }
                FieldLabel("Email")
                ProplystTextField(
                    value = uiState.email,
                    onValueChange = onEmailChange,
                    placeholder = "you@example.com",
                    enabled = !uiState.isSubmitting,
                )
                Spacer(modifier = Modifier.height(14.dp))
                FieldLabel("Password")
                ProplystTextField(
                    value = uiState.password,
                    onValueChange = onPasswordChange,
                    placeholder = "••••••••",
                    enabled = !uiState.isSubmitting,
                    visualTransformation = if (uiState.showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = onTogglePasswordVisibility) {
                            Icon(
                                if (uiState.showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                contentDescription = if (uiState.showPassword) "Hide password" else "Show password",
                            )
                        }
                    },
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    "Forgot password?",
                    style = ProplystTheme.type.captionEmphasis,
                    color = ProplystTheme.colors.primary,
                    modifier = Modifier
                        .align(Alignment.End)
                        .clickable(onClick = onForgotPasswordClick)
                        .padding(4.dp),
                )
                Spacer(modifier = Modifier.height(14.dp))
                Button(
                    onClick = onSignInClick,
                    enabled = !uiState.isSubmitting,
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = ProplystTheme.colors.primary),
                    modifier = Modifier.fillMaxWidth().height(54.dp),
                ) {
                    if (uiState.isSubmitting) {
                        CircularProgressIndicator(color = Color.White, strokeWidth = 2.5.dp, modifier = Modifier.size(18.dp).padding(end = 8.dp))
                    }
                    Text(if (uiState.isSubmitting) "Signing in…" else "Sign in", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                Spacer(modifier = Modifier.height(18.dp))
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Divider1()
                    Text("or continue with", style = ProplystTheme.type.caption, color = ProplystTheme.colors.textTertiary, modifier = Modifier.padding(horizontal = 10.dp))
                    Divider1()
                }
                Spacer(modifier = Modifier.height(18.dp))
                OutlinedButton(
                    onClick = onGoogleClick,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    border = BorderStroke(1.dp, ProplystTheme.colors.border),
                ) {
                    Text("G", color = ProplystTheme.colors.primary, fontWeight = FontWeight.Bold, modifier = Modifier.padding(end = 8.dp))
                    Text("Continue with Google", color = ProplystTheme.colors.textPrimary)
                }
                if (!googleSignInAvailable) {
                    Text(
                        "Google Sign-In requires configuration by Proplyst before it's available.",
                        style = ProplystTheme.type.caption,
                        color = ProplystTheme.colors.textTertiary,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun RowScope.Divider1() {
    Box(modifier = Modifier.weight(1f).height(1.dp).background(ProplystTheme.colors.divider))
}

@Composable
private fun FieldLabel(text: String) {
    Text(text, style = ProplystTheme.type.captionEmphasis, color = ProplystTheme.colors.textSecondary, modifier = Modifier.padding(bottom = 6.dp))
}

@Composable
private fun ProplystTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    enabled: Boolean,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    trailingIcon: (@Composable () -> Unit)? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text(placeholder, color = ProplystTheme.colors.textTertiary) },
        enabled = enabled,
        singleLine = true,
        shape = RoundedCornerShape(14.dp),
        visualTransformation = visualTransformation,
        trailingIcon = trailingIcon,
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = ProplystTheme.colors.inputSurface,
            unfocusedContainerColor = ProplystTheme.colors.inputSurface,
            focusedBorderColor = ProplystTheme.colors.primary,
            unfocusedBorderColor = ProplystTheme.colors.border,
        ),
        modifier = Modifier.fillMaxWidth().height(56.dp),
    )
}

@Composable
private fun ErrorBanner(message: String, kind: SignInErrorKind) {
    val (bg, border, text) = when (kind) {
        SignInErrorKind.NETWORK -> Triple(ProplystTheme.colors.networkBg, ProplystTheme.colors.networkBorder, ProplystTheme.colors.networkText)
        SignInErrorKind.INVALID_CREDENTIALS -> Triple(ProplystTheme.colors.criticalBgAlt, ProplystTheme.colors.criticalBorder, ProplystTheme.colors.criticalDeep)
        SignInErrorKind.GENERIC -> Triple(ProplystTheme.colors.criticalBgAlt, ProplystTheme.colors.criticalBorder, ProplystTheme.colors.criticalDeep)
    }
    Surface(
        color = bg,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(message, style = ProplystTheme.type.caption, color = text, modifier = Modifier.padding(12.dp))
    }
}

@Composable
private fun ForgotPasswordContent(
    uiState: SignInUiState,
    onEmailChange: (String) -> Unit,
    onBack: () -> Unit,
    onSend: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize().background(ProplystTheme.colors.navy).statusBarsPadding()) {
        Row(modifier = Modifier.padding(top = 8.dp, start = 12.dp)) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Color.White)
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp).fillMaxWidth()) {
            Text(
                if (uiState.mode == SignInMode.FORGOT_SENT) "Check your email" else "Reset your password",
                style = ProplystTheme.type.screenTitle,
                color = Color.White,
            )
        }
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
            modifier = Modifier.fillMaxSize().padding(top = 24.dp),
        ) {
            Column(modifier = Modifier.padding(horizontal = 22.dp, vertical = 26.dp)) {
                if (uiState.mode == SignInMode.FORGOT_SENT) {
                    Box(
                        modifier = Modifier.size(84.dp).background(ProplystTheme.colors.blueTint, androidx.compose.foundation.shape.CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Filled.Email, contentDescription = null, tint = ProplystTheme.colors.primary, modifier = Modifier.size(36.dp))
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        "If an account exists for that email, we've sent a link to reset your password.",
                        style = ProplystTheme.type.body,
                        color = ProplystTheme.colors.textSecondary,
                    )
                    Spacer(modifier = Modifier.height(20.dp))
                    OutlinedButton(onClick = onBack, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().height(50.dp)) {
                        Text("Back to sign in")
                    }
                } else {
                    FieldLabel("Email")
                    ProplystTextField(value = uiState.forgotEmail, onValueChange = onEmailChange, placeholder = "you@example.com", enabled = !uiState.isSendingReset)
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(
                        onClick = onSend,
                        enabled = !uiState.isSendingReset && uiState.forgotEmail.isNotBlank(),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = ProplystTheme.colors.primary),
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                    ) {
                        if (uiState.isSendingReset) {
                            CircularProgressIndicator(color = Color.White, strokeWidth = 2.5.dp, modifier = Modifier.size(18.dp).padding(end = 8.dp))
                        }
                        Text(if (uiState.isSendingReset) "Sending…" else "Send reset link", fontWeight = FontWeight.Bold)
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        "Back to sign in",
                        style = ProplystTheme.type.captionEmphasis,
                        color = ProplystTheme.colors.primary,
                        modifier = Modifier.align(Alignment.CenterHorizontally).clickable(onClick = onBack).padding(6.dp),
                    )
                }
            }
        }
    }
}
