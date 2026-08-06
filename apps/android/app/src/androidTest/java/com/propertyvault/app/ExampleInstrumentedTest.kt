package com.propertyvault.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumentation test structure foundation -- runs on a real device/emulator, unlike the
 * `src/test` unit tests. Kept to a real, minimal smoke assertion (correct application package)
 * rather than an empty placeholder; the actual verified vertical-slice smoke test for this
 * milestone is the manual sign-in/navigation/screen-rendering pass recorded in WORKLOG.md, since
 * writing real Compose UI instrumentation tests (`createAndroidComposeRule`, semantics-tree
 * assertions against Hilt-injected screens) is itself a next increment, not assumed complete here.
 */
@RunWith(AndroidJUnit4::class)
class ExampleInstrumentedTest {
    @Test
    fun useAppContext() {
        val appContext = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals("com.propertyvault.app", appContext.packageName)
    }
}
