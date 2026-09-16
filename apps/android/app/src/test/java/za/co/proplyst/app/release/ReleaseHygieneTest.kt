package za.co.proplyst.app.release

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Guards two things that must stay true of the shipped Android app, by reading the source tree
 * itself rather than any one class.
 *
 * Both are policy constraints, not behaviour a ViewModel can express, and both are the kind of
 * thing a well-meaning future change reintroduces without noticing:
 *
 *  1. NO EXTERNAL SUBSCRIPTION PURCHASING. Google Play's Payments policy requires Play's billing
 *     system for subscription cloud software (§3) and separately forbids leading users to an
 *     alternative payment method through in-app buttons or links (§4). Android v1.0 therefore has
 *     no purchase surface at all -- an organisation subscribes on the web, and an already-entitled
 *     account signs in here and uses what its plan allows.
 *
 *  2. NO DEAD SIGN-IN CONTROL. The Google button must be rendered only when it can actually work.
 *
 * A source scan is deliberately coarse, which is the point: it catches a new billing link anywhere
 * in the app, including in a screen this test has never heard of.
 */
class ReleaseHygieneTest {

    private val sourceRoot = File("src/main/java/za/co/proplyst/app")

    private fun kotlinSources(): List<File> {
        assertTrue(
            "source root not found at ${sourceRoot.absolutePath} -- fix the path, do not delete the test",
            sourceRoot.isDirectory,
        )
        return sourceRoot.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
    }

    /**
     * Source with comments stripped -- both `//` lines and `/* */` blocks -- so that prose
     * *explaining* a removal is never mistaken for the thing it describes.
     *
     * Stripping only `//` was not enough and produced a real false positive: the KDoc on
     * DashboardViewModel cites `release/google-play/BILLING_COMPLIANCE.md`, whose path contains
     * "/billing". The rule was right and the scanner was wrong, so the scanner was fixed.
     */
    private fun code(f: File): String {
        val noBlocks = f.readText().replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), " ")
        return noBlocks.lines().joinToString("\n") { it.substringBefore("//") }
    }

    @Test
    fun `no android source contains an external billing or payment URL`() {
        val banned = listOf("payfast", "organization/billing", "/billing", "checkout", "subscribe?")
        val offenders = mutableListOf<String>()
        for (f in kotlinSources()) {
            val body = code(f).lowercase()
            for (needle in banned) {
                if (needle in body) offenders.add("${f.name}: '$needle'")
            }
        }
        assertEquals(
            "Android must contain no external subscription/payment link. Offenders: $offenders",
            emptyList<String>(), offenders,
        )
    }

    @Test
    fun `the More screen has no subscription or billing entry point`() {
        val more = kotlinSources().single { it.name == "OwnerMoreScreen.kt" }
        val body = code(more).lowercase()
        for (label in listOf("manage subscription", "billing and plan", "upgrade", "web_billing_url")) {
            assertTrue("OwnerMoreScreen must not offer '$label'", label !in body)
        }
    }

    @Test
    fun `no android source steers the user to buy or upgrade externally`() {
        // User-visible copy only: string literals, not identifiers like WhileSubscribed.
        val steering = Regex(
            """"[^"]*\b(upgrade your plan|buy a plan|purchase a subscription|subscribe now|manage your subscription|opens in browser)\b[^"]*"""",
            RegexOption.IGNORE_CASE,
        )
        val offenders = kotlinSources()
            .filter { steering.containsMatchIn(code(it)) }
            .map { it.name }
        assertEquals("no external purchase steering copy may ship", emptyList<String>(), offenders)
    }

    @Test
    fun `the sign-in screen renders Google only when it is available`() {
        val signIn = kotlinSources().single { it.name == "SignInScreen.kt" }
        val body = code(signIn)

        // The dead-button caption must be gone outright.
        assertTrue(
            "the 'requires configuration' caption must not ship",
            "requires configuration" !in body.lowercase(),
        )

        // "Continue with Google", the G badge and the "or continue with" divider must all sit
        // inside the availability gate, not merely somewhere in the file.
        val gate = body.indexOf("if (googleSignInAvailable)")
        assertTrue("the Google block must be gated on googleSignInAvailable", gate >= 0)

        val gatedRegion = body.substring(gate)
        for (piece in listOf("Continue with Google", "or continue with")) {
            val at = body.indexOf(piece)
            assertTrue("'$piece' is missing entirely -- it should be gated, not deleted", at >= 0)
            assertTrue("'$piece' must render only inside the availability gate", at > gate)
        }
        assertTrue("the gated block must still be present", "Continue with Google" in gatedRegion)
    }

    @Test
    fun `google sign-in remains wired so a configured build restores it`() {
        // This is a visibility gate, not a removal: the parameter and click handler must survive so
        // that setting GOOGLE_WEB_CLIENT_ID brings the button back with no further code change.
        val signIn = code(kotlinSources().single { it.name == "SignInScreen.kt" })
        assertTrue("googleSignInAvailable parameter must remain", "googleSignInAvailable: Boolean" in signIn)
        assertTrue("onGoogleClick wiring must remain", "onClick = onGoogleClick" in signIn)

        val vm = code(kotlinSources().single { it.name == "SignInViewModel.kt" })
        assertTrue(
            "availability must still derive from the configured client id",
            "googleAuthConfig.isConfigured" in vm,
        )
        // The id itself comes from the build, never from a literal in source (2026-09-16): the
        // ViewModel takes it through GoogleAuthConfig so it can be tested both ways.
        val module = kotlinSources().single { it.name == "GoogleAuthModule.kt" }
        assertTrue(
            "the client id must come from BuildConfig",
            "BuildConfig.GOOGLE_WEB_CLIENT_ID" in code(module),
        )
        val hardCoded = kotlinSources().filter { "apps.googleusercontent.com" in code(it) }.map { it.name }
        assertEquals("no OAuth client id may be hard-coded in source", emptyList<String>(), hardCoded)
    }

    @Test
    fun `no localhost or emulator-loopback URL is hard-coded in shipped source`() {
        val offenders = kotlinSources().filter { f ->
            val body = code(f)
            ("localhost" in body || "10.0.2.2" in body || "127.0.0.1" in body) &&
                "BuildConfig" !in body
        }.map { it.name }
        assertEquals("no shipped source may hard-code a development host", emptyList<String>(), offenders)
    }

    // 2026-09-14, Android release P0: Google Play's User Data policy requires a privacy policy link
    // inside the app. Raw text on purpose -- code() above cuts lines at "//", which would truncate URLs.
    @Test
    fun `privacy policy and terms are linked from the owner More screen and the tenant Profile screen`() {
        val legal = File(sourceRoot, "ui/common/LegalLinks.kt").readText()
        assertTrue(legal.contains("const val PRIVACY_POLICY_URL = \"https://proplyst.co.za/privacy\""))
        assertTrue(legal.contains("const val TERMS_OF_SERVICE_URL = \"https://proplyst.co.za/terms\""))
        // Any WebView use needs android.webkit, imported or fully qualified; comments cannot trip this.
        assertTrue("legal pages open in the browser, never a WebView", !legal.contains("android.webkit"))

        for (screen in listOf("ui/more/OwnerMoreScreen.kt", "ui/tenancy/TenantProfileScreen.kt")) {
            val text = File(sourceRoot, screen).readText()
            assertTrue("$screen: Privacy Policy row", text.contains("\"Privacy Policy\""))
            assertTrue("$screen: Terms of Service row", text.contains("\"Terms of Service\""))
            assertTrue("$screen opens the privacy policy", text.contains("openLegalPage(context, LegalLinks.PRIVACY_POLICY_URL)"))
            assertTrue("$screen opens the terms", text.contains("openLegalPage(context, LegalLinks.TERMS_OF_SERVICE_URL)"))
        }
    }

    // 2026-09-14, Android release P0: allowBackup=false does not stop Android 12+ device-to-device
    // transfer; a transferred encrypted session file cannot be decrypted without its Keystore key.
    @Test
    fun `session data is excluded from cloud backup and from device-to-device transfer`() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android:allowBackup=\"false\""))
        assertTrue(manifest.contains("android:dataExtractionRules=\"@xml/data_extraction_rules\""))
        assertTrue(manifest.contains("android:fullBackupContent=\"@xml/backup_rules\""))
        val legacyRules = File("src/main/res/xml/backup_rules.xml").readText()
        assertTrue("Android 11 and lower exclude app data too", legacyRules.contains("<exclude domain=\"root\" path=\".\" />"))

        val rules = File("src/main/res/xml/data_extraction_rules.xml").readText()
        for (section in listOf("cloud-backup", "device-transfer")) {
            val body = rules.substringAfter("<$section>").substringBefore("</$section>")
            assertTrue("$section excludes app data", body.contains("<exclude domain=\"root\" path=\".\" />"))
            assertTrue("$section excludes device-protected data", body.contains("<exclude domain=\"device_root\" path=\".\" />"))
        }
    }

    // 2026-09-15: the Play Console app is registered as za.co.genbridge.proplyst, with no bundle
    // uploaded yet. A bundle under any other applicationId would need a new Play listing, and the
    // applicationId can never change after the first upload.
    @Test
    fun `the applicationId is the Play Console package and everything derived from it agrees`() {
        val playPackage = "za.co.genbridge.proplyst"
        val gradle = File("build.gradle.kts").readText()
        val applicationIds = Regex("""applicationId\s*=\s*"([^"]+)"""").findAll(gradle).map { it.groupValues[1] }.toList()
        assertEquals("exactly one applicationId, the Play package", listOf(playPackage), applicationIds)
        assertTrue("no suffix or flavour may alter the published package", !gradle.contains("applicationIdSuffix") && !gradle.contains("productFlavors"))

        // FileProvider authorities must follow the applicationId, not the Kotlin namespace:
        // WebApiInvoicesRepository resolves "${packageName}.fileprovider" at runtime.
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android:authorities=\"\${applicationId}.fileprovider\""))
        val literalAuthorities = kotlinSources().filter { code(it).contains(Regex(""""[a-z0-9_.]+\.fileprovider"""")) }.map { it.name }
        assertEquals("no hard-coded FileProvider authority", emptyList<String>(), literalAuthorities)

        // The web app's /.well-known/assetlinks.json names this package for App Links verification.
        val branding = File("../../../packages/config/src/branding.ts")
        assertTrue("branding.ts not found at ${branding.absolutePath}", branding.isFile)
        assertTrue("assetlinks.json package must match", branding.readText().contains("androidPackageName: '$playPackage'"))
    }
}
