package za.co.proplyst.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import za.co.proplyst.app.navigation.PendingDeepLinkStore
import za.co.proplyst.app.navigation.RootNavGraph
import za.co.proplyst.app.navigation.parseAppLink
import za.co.proplyst.app.ui.theme.ProplystTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/** `android:launchMode="singleTask"` (AndroidManifest.xml, alongside the App Links intent-filter)
 * means a link tapped while the app is already running arrives via onNewIntent(), not a second
 * Activity instance -- both onCreate() and onNewIntent() capture intent.data the same way
 * (Android V1 last local blocker pass, WORKLOG.md this date). */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var pendingDeepLinkStore: PendingDeepLinkStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        captureDeepLink(intent)
        setContent {
            ProplystTheme {
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
