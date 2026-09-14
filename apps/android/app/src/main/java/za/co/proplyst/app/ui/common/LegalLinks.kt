package za.co.proplyst.app.ui.common

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast

/**
 * Proplyst's published legal pages (2026-09-14, Android release P0). Google Play's User Data policy
 * requires a privacy policy link inside the app itself, not only on the store listing; the Terms sit
 * beside it. Both rows appear on the owner More screen and the tenant Profile screen, where they are
 * reachable before signing out or deleting the account.
 */
object LegalLinks {
    const val PRIVACY_POLICY_URL = "https://proplyst.co.za/privacy"
    const val TERMS_OF_SERVICE_URL = "https://proplyst.co.za/terms"
}

/**
 * Opens a fixed HTTPS page in the user's own browser -- no WebView (so no certificate handling of
 * our own) and no permission. Shows a short message instead of failing when nothing can open links.
 */
fun openLegalPage(context: Context, url: String) {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, "No app on this device can open $url", Toast.LENGTH_LONG).show()
    }
}
