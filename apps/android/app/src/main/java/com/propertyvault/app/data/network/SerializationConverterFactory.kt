package com.propertyvault.app.data.network

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import okhttp3.MediaType
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody
import retrofit2.Converter
import retrofit2.Retrofit
import java.lang.reflect.Type

/**
 * Hand-rolled kotlinx.serialization <-> Retrofit bridge -- replaces an external converter
 * library (`com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter`) after that
 * dependency, though confirmed present on both the debug compile and runtime classpaths via
 * `gradlew app:dependencies`, produced a persistent, unexplained "Unresolved reference" from the
 * Kotlin compiler that survived a full clean + daemon restart. Rather than keep debugging an
 * opaque toolchain issue, this uses `kotlinx.serialization`'s own JVM-reflection bridge
 * (`kotlinx.serialization.serializer(java.lang.reflect.Type)`, `@ExperimentalSerializationApi`,
 * published directly by `kotlinx-serialization-core` -- exactly the Java-interop entry point this
 * kind of converter needs, including correct handling of generic types like `List<PropertyDto>`)
 * instead of depending on the external library. If a future session isolates the real cause of
 * the original unresolved-reference failure, reintroducing that library is a one-file revert.
 */
@OptIn(ExperimentalSerializationApi::class)
class SerializationConverterFactory private constructor(
    private val json: Json,
    private val contentType: MediaType,
) : Converter.Factory() {

    override fun responseBodyConverter(
        type: Type,
        annotations: Array<out Annotation>,
        retrofit: Retrofit,
    ): Converter<ResponseBody, *> {
        val serializer: KSerializer<Any> = serializer(type)
        return Converter<ResponseBody, Any> { body ->
            body.use { json.decodeFromString(serializer, it.string()) }
        }
    }

    override fun requestBodyConverter(
        type: Type,
        parameterAnnotations: Array<out Annotation>,
        methodAnnotations: Array<out Annotation>,
        retrofit: Retrofit,
    ): Converter<*, RequestBody> {
        val serializer: KSerializer<Any> = serializer(type)
        return Converter<Any, RequestBody> { value ->
            json.encodeToString(serializer, value).toRequestBody(contentType)
        }
    }

    companion object {
        fun create(json: Json, contentType: MediaType): SerializationConverterFactory =
            SerializationConverterFactory(json, contentType)
    }
}
