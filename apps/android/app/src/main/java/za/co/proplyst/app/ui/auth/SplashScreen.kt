package za.co.proplyst.app.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import za.co.proplyst.app.R

/** NATIVE_ANDROID_SPEC.md's auth shell -- shown while AuthRepository.restoreSession() resolves
 * whether a stored session is still valid, before routing to sign-in or the owner root. Reads
 * R.string.app_name rather than a hardcoded literal (Android V1 final gap-closure pass,
 * WORKLOG.md this date, Phase 11) -- this screen was still showing "PropertyVault" on-screen
 * even though the launcher label/Play listing name was already corrected to "Proplyst" in the
 * prior pass; a real, live inconsistency a user would see on every cold start. */
@Composable
fun SplashScreen() {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineMedium)
        CircularProgressIndicator(modifier = Modifier.padding(top = 16.dp))
    }
}
