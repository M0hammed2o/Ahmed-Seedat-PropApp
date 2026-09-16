package za.co.proplyst.app.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import za.co.proplyst.app.BuildConfig
import za.co.proplyst.app.data.auth.GoogleAuthConfig
import javax.inject.Singleton

/**
 * The OAuth Web client ID "Continue with Google" runs against, read from the build (local.properties
 * -> BuildConfig, never committed). It is a public identifier, not a secret: Google prints it in
 * every ID token's audience, and Supabase is configured with the same one for web sign-in -- which
 * is exactly why both clients resolve to one Proplyst account.
 *
 * Injected rather than read from BuildConfig at the call site so the sign-in ViewModel can be tested
 * with and without a configured build.
 */
@Module
@InstallIn(SingletonComponent::class)
object GoogleAuthModule {

    @Provides
    @Singleton
    fun provideGoogleAuthConfig(): GoogleAuthConfig = GoogleAuthConfig(BuildConfig.GOOGLE_WEB_CLIENT_ID)
}
