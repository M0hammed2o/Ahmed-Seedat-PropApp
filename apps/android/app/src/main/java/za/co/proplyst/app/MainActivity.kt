package za.co.proplyst.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.fragment.app.FragmentActivity
import za.co.proplyst.app.data.appearance.AppearancePreferences
import za.co.proplyst.app.navigation.PendingDeepLinkStore
import za.co.proplyst.app.navigation.RootNavGraph
import za.co.proplyst.app.navigation.parseAppLink
import za.co.proplyst.app.ui.theme.ProplystTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/** `android:launchMode="singleTask"` (AndroidManifest.xml, alongside the App Links intent-filter)
 * means a link tapped while the app is already running arrives via onNewIntent(), not a second
 * Activity instance -- both onCreate() and onNewIntent() capture intent.data the same way
 * (Android V1 last local blocker pass, WORKLOG.md this date).
 *
 * `FragmentActivity` (not `ComponentActivity`) -- required to host `BiometricPrompt`
 * (auth/session hardening pass, WORKLOG.md this date, NATIVE_ANDROID_SPEC.md §12).
 * `FragmentActivity` extends `ComponentActivity`, so every existing API used below
 * (`enableEdgeToEdge()`, `setContent {}`) is unaffected. */
@AndroidEntryPoint
class MainActivity : FragmentActivity() {

    @Inject
    lateinit var pendingDeepLinkStore: PendingDeepLinkStore

    @Inject
    lateinit var appearancePreferences: AppearancePreferences

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        captureDeepLink(intent)
        setContent {
            val themeMode by appearancePreferences.themeMode.collectAsState()
            ProplystTheme(themeMode = themeMode) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    RootNavGraph()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        captureDeepLink(intent)
    }

    private fun captureDeepLink(intent: Intent) {
        val path = intent.data?.path ?: return
        pendingDeepLinkStore.set(parseAppLink(path))
    }
}
