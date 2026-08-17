import java.util.Properties
import java.io.FileInputStream

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

// Public client configuration only (Supabase URL + anon key -- safe for a client bundle, RLS is
// the real access boundary, matching ENVIRONMENT.md's NEXT_PUBLIC_*/EXPO_PUBLIC_* convention for
// every other client in this monorepo). NEVER a service-role key. Read from local.properties
// (gitignored, project-local per Mohammed's "prefer project-local configuration" instruction) with
// an empty-string fallback so a clean checkout still compiles -- see local.properties.example and
// README.md for what a developer must fill in before the app can actually reach a real backend.
val localProperties = Properties().apply {
    val localPropertiesFile = rootProject.file("local.properties")
    if (localPropertiesFile.exists()) {
        load(FileInputStream(localPropertiesFile))
    }
}
val supabaseUrl: String = localProperties.getProperty("SUPABASE_URL", "")
val supabaseAnonKey: String = localProperties.getProperty("SUPABASE_ANON_KEY", "")
// Next.js API base URL (the apps/web deployment, or a local `pnpm --filter admin dev` instance --
// 10.0.2.2 is the Android emulator's alias for the host machine's localhost). Only ever hit for
// endpoints that need real server-side business logic (API_SPEC.md §0); RLS-protected reads go
// straight to Supabase's PostgREST, matching "no client bypassing business logic to write
// Postgres directly except for plain RLS-protected reads."
val apiBaseUrl: String = localProperties.getProperty("API_BASE_URL", "http://10.0.2.2:3000")
// Build-time switch between MockPropertiesRepository and PostgrestPropertiesRepository
// (di/RepositoryModule.kt) -- project-local config per Mohammed's instruction, not a runtime
// toggle inside the real repository (which would risk mock behaviour leaking into it).
val useMockData: Boolean = localProperties.getProperty("USE_MOCK_DATA", "false").toBoolean()

// Release-only config (Android V1 last local blocker pass, WORKLOG.md this date): a real, separate
// RELEASE_* property set, deliberately with NO loopback-address fallback. Before this, a release
// build produced without local.properties fully filled in would silently bake in
// http://10.0.2.2:3000 (the emulator's own loopback alias) as BuildConfig.API_BASE_URL -- on a
// real device that address resolves to nothing meaningful, so the app would build and install
// fine and then fail every network call in a way that gives no hint the endpoint itself was
// misconfigured. Empty-string is deliberately used instead: still fails, but obviously (an empty
// base URL throws immediately on the first request), not silently-wrong. See
// local.properties.example for what a real release build needs before this is filled in.
val releaseSupabaseUrl: String = localProperties.getProperty("RELEASE_SUPABASE_URL", "")
val releaseSupabaseAnonKey: String = localProperties.getProperty("RELEASE_SUPABASE_ANON_KEY", "")
val releaseApiBaseUrl: String = localProperties.getProperty("RELEASE_API_BASE_URL", "")

android {
    // Android V1 final gap-closure pass (WORKLOG.md this date), Phase 1: renamed from
    // com.propertyvault.app -- the product is Proplyst, and this had never been published to
    // Google Play (versionCode 1, no real installs), so there is no post-publish
    // applicationId-permanence constraint blocking the change. za.co.proplyst.app follows the
    // reverse-domain convention for a South African product (za.co.<company>.<app>), matching
    // proplyst.co.za's own real domain.
    namespace = "za.co.proplyst.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "za.co.proplyst.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")

            buildConfigField("String", "SUPABASE_URL", "\"$releaseSupabaseUrl\"")
            buildConfigField("String", "SUPABASE_ANON_KEY", "\"$releaseSupabaseAnonKey\"")
            buildConfigField("String", "API_BASE_URL", "\"$releaseApiBaseUrl\"")
            // Never sourced from local.properties for release, regardless of what a developer's
            // own USE_MOCK_DATA value happens to be set to for local UI work -- a release build
            // must never be able to accidentally ship with mock data baked in.
            buildConfigField("boolean", "USE_MOCK_DATA", "false")
        }
        debug {
            // Debug builds may point at a local `supabase start` instance -- no separate flag
            // needed, the developer's own local.properties value governs both build types for now
            // (matches this repo's existing "no separate mock backend toggle" simplicity until a
            // real staging environment exists, ENVIRONMENT.md).
            buildConfigField("String", "SUPABASE_URL", "\"$supabaseUrl\"")
            buildConfigField("String", "SUPABASE_ANON_KEY", "\"$supabaseAnonKey\"")
            buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
            buildConfigField("boolean", "USE_MOCK_DATA", "$useMockData")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material3.windowsizeclass)
    implementation(libs.androidx.compose.material.icons.extended)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    implementation(libs.androidx.navigation.compose)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    implementation(libs.retrofit.core)
    implementation(libs.okhttp.core)
    implementation(libs.okhttp.logging.interceptor)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    implementation(libs.androidx.work.runtime.ktx)

    implementation(libs.androidx.biometric)
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.datastore.preferences)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.mockk)
    testImplementation(libs.turbine)

    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
}
