# Add project specific ProGuard rules here.
# R8 is ON for the Google Play release build (app/build.gradle.kts). These rules are exercised by
# every `bundleRelease`, not groundwork.

# kotlinx.serialization (standard rules from the library's own README) -- this app's
# SerializationConverterFactory resolves a KSerializer at runtime via reflection
# (kotlinx.serialization.serializer(java.lang.reflect.Type)), so R8 has no static call site to see
# that a DTO's generated .serializer()/Companion is reachable; without these rules a minified
# build would compile and install fine but throw at the first real network response.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class za.co.proplyst.app.**$$serializer { *; }
-keepclassmembers class za.co.proplyst.app.** {
    *** Companion;
}
-keepclasseswithmembers class za.co.proplyst.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Room compiles its query/entity classes at build time and ships its own consumer-rules.pro via
# the androidx.room:room-runtime AAR -- no manual entity-name keep rules needed here.

# Tink, pulled in by androidx.security.crypto (EncryptedSharedPreferences, which holds the session
# token), references Error Prone's annotations. Those are compile-time only and deliberately absent
# at runtime, so R8 correctly reports them missing and, with no rule, fails the whole build. They
# affect no runtime behaviour -- suppressing the warning is the documented fix, not a workaround.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**

# Do NOT blanket-keep com.google.crypto.tink.**: that forces R8 to retain KeysDownloader, a remote
# keyset-fetch utility this app never calls, which in turn references google-api-client and Joda
# Time -- neither of which is a dependency, so the build then fails on those instead.
# androidx.security.crypto ships its own consumer rules for the Tink surface it actually uses.
-dontwarn com.google.api.client.**
-dontwarn com.google.api.**
-dontwarn org.joda.time.**

# OkHttp/Retrofit ship their own consumer rules, but OkHttp's optional Conscrypt/BouncyCastle
# platform lookups are reflective and absent on Android.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
