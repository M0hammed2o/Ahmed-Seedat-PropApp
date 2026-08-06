package com.propertyvault.app.ui.auth

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
import androidx.compose.ui.unit.dp

/** NATIVE_ANDROID_SPEC.md's auth shell -- shown while AuthRepository.restoreSession() resolves
 * whether a stored session is still valid, before routing to sign-in or the owner root. */
@Composable
fun SplashScreen() {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("PropertyVault", style = MaterialTheme.typography.headlineMedium)
        CircularProgressIndicator(modifier = Modifier.padding(top = 16.dp))
    }
}
