package com.propertyvault.app.di

import com.propertyvault.app.BuildConfig
import com.propertyvault.app.data.auth.SessionManager
import com.propertyvault.app.data.network.PostgrestApi
import com.propertyvault.app.data.network.SupabaseAuthApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import com.propertyvault.app.data.network.SerializationConverterFactory
import javax.inject.Named
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Every Supabase call (auth + PostgREST) needs the project's anon `apikey` header --
     * required by Supabase's API gateway regardless of whether the caller also carries a user
     * JWT (ENVIRONMENT.md's NEXT_PUBLIC_SUPABASE_ANON_KEY is the exact same value, "safe for
     * client" by design, RLS is the real boundary).
     */
    private fun apiKeyInterceptor(): Interceptor = Interceptor { chain ->
        val request = chain.request().newBuilder()
            .addHeader("apikey", BuildConfig.SUPABASE_ANON_KEY)
            .build()
        chain.proceed(request)
    }

    /**
     * Adds the caller's own session JWT as a bearer token, when one exists -- this is what makes
     * a PostgREST read run AS the signed-in user (so RLS scopes it to their own orgs), not as the
     * anon role. Sign-in itself has no token yet, so this interceptor is a no-op until
     * SessionManager has something to add.
     */
    private fun authInterceptor(sessionManager: SessionManager): Interceptor = Interceptor { chain ->
        val token = sessionManager.getAccessToken()
        val request = if (token != null) {
            chain.request().newBuilder().addHeader("Authorization", "Bearer $token").build()
        } else {
            chain.request()
        }
        chain.proceed(request)
    }

    @Provides
    @Singleton
    fun provideSupabaseOkHttpClient(sessionManager: SessionManager): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
        }
        return OkHttpClient.Builder()
            .addInterceptor(apiKeyInterceptor())
            .addInterceptor(authInterceptor(sessionManager))
            .addInterceptor(logging)
            .build()
    }

    @Provides
    @Singleton
    @Named("supabase")
    fun provideSupabaseRetrofit(okHttpClient: OkHttpClient): Retrofit {
        val contentType = "application/json".toMediaType()
        return Retrofit.Builder()
            .baseUrl(ensureTrailingSlash(BuildConfig.SUPABASE_URL))
            .client(okHttpClient)
            .addConverterFactory(SerializationConverterFactory.create(json, contentType))
            .build()
    }

    @Provides
    @Singleton
    fun provideSupabaseAuthApi(@Named("supabase") retrofit: Retrofit): SupabaseAuthApi =
        retrofit.create(SupabaseAuthApi::class.java)

    @Provides
    @Singleton
    fun providePostgrestApi(@Named("supabase") retrofit: Retrofit): PostgrestApi =
        retrofit.create(PostgrestApi::class.java)

    private fun ensureTrailingSlash(url: String): String = if (url.endsWith("/")) url else "$url/"
}
