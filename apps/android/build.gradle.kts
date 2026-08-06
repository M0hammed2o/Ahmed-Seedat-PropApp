// Root build script -- TASKS.md M22, NATIVE_ANDROID_SPEC.md. Plugin versions declared here,
// applied per-module with `apply false` at the root and the real `id(...)` in app/build.gradle.kts,
// matching the standard Android Gradle Plugin project layout (AGP 8.x convention).
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.ksp) apply false
}
