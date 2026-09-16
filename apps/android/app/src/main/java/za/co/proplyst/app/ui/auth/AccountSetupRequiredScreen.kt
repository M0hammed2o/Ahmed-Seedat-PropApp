package za.co.proplyst.app.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import za.co.proplyst.app.ui.common.openLegalPage
import za.co.proplyst.app.ui.theme.ProplystPillShape
import za.co.proplyst.app.ui.theme.ProplystTheme

/** Where a signed-in account with no portal access finishes setting up. */
const val PROPLYST_WEB_SETUP_URL = "https://proplyst.co.za/login"

/**
 * Signed in, but the account belongs to no organisation and no tenancy yet.
 *
 * This is what a brand-new Google account looks like the first time it signs in from the phone: the
 * identity exists, the Proplyst side of it does not. Organisation creation and plan selection are
 * deliberately web-only -- the plan step ends in a payment flow, which must never live inside the
 * Android app (BILLING_COMPLIANCE.md) -- so the honest thing here is to say so and hand off, rather
 * than bounce the user back to a sign-in screen they just completed.
 */
@Composable
fun AccountSetupRequiredScreen(onSignOut: () -> Unit) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("You're signed in", style = type.settingsTitle, color = colors.textPrimary)
        Spacer(Modifier.height(10.dp))
        Text(
            "This account isn't set up on Proplyst yet. Finish setting it up on the web — " +
                "create your organisation and choose a plan — then sign in here again.",
            style = type.body,
            color = colors.textSecondary,
        )
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = { openLegalPage(context, PROPLYST_WEB_SETUP_URL) },
            shape = ProplystPillShape,
            colors = ButtonDefaults.buttonColors(containerColor = colors.primary),
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) {
            Text("Continue on proplyst.co.za", style = type.button)
        }
        Spacer(Modifier.height(4.dp))
        TextButton(onClick = onSignOut, shape = RoundedCornerShape(12.dp)) {
            Text("Use a different account", style = type.buttonSecondary, color = colors.textSecondary)
        }
    }
}
