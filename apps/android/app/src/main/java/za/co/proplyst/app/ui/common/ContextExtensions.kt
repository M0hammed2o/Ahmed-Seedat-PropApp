package za.co.proplyst.app.ui.common

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper

/**
 * The Activity behind a Compose `LocalContext`, or null if there isn't one.
 *
 * Compose hands out a Context that is usually a ContextWrapper chain (the theme wrapper, for one),
 * so a plain `as? Activity` cast misses it. Anything that must be hosted by an Activity -- the
 * Google account picker, the biometric prompt -- needs the real thing.
 */
fun Context.findActivity(): Activity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return null
}
