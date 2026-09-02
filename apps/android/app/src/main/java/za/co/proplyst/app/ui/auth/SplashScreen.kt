package za.co.proplyst.app.ui.auth

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import za.co.proplyst.app.R
import za.co.proplyst.app.ui.theme.ProplystTheme

/** NATIVE_ANDROID_SPEC.md's auth shell -- shown while AuthRepository.restoreSession() resolves
 * whether a stored session is still valid, before routing to sign-in or the owner root. Proplyst
 * Mobile Design System redesign pass: navy background + the real Proplyst mark, matching the
 * sign-in screen's own navy header instead of a plain text app name on a blank background. */
@Composable
fun SplashScreen() {
    Column(
        modifier = Modifier.fillMaxSize().background(ProplystTheme.colors.navy),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Image(
            painter = painterResource(R.drawable.proplyst_logo_mark),
            contentDescription = "Proplyst",
            modifier = Modifier.size(72.dp),
        )
        CircularProgressIndicator(color = Color.White, modifier = Modifier.padding(top = 20.dp).size(24.dp))
    }
}
