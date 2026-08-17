# Add project specific ProGuard rules here.
# minifyEnabled is still off (see app/build.gradle.kts's own comment on why) -- these rules are
# groundwork for when it's turned on, not yet exercised by any build. Android V1 final
# gap-closure pass (WORKLOG.md this date), Phase 12.

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
