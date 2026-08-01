package com.propertyvault.app.di

import com.propertyvault.app.BuildConfig
import com.propertyvault.app.data.auth.AuthRepository
import com.propertyvault.app.data.auth.MockAuthRepository
import com.propertyvault.app.data.auth.SupabaseAuthRepository
import com.propertyvault.app.data.properties.MockPropertiesRepository
import com.propertyvault.app.data.properties.PostgrestPropertiesRepository
import com.propertyvault.app.data.properties.PropertiesRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object RepositoryModule {
    // BuildConfig.USE_MOCK_DATA (local.properties-controlled, see app/build.gradle.kts) picks
    // exactly one implementation -- never both, never a runtime branch inside the real one.
    @Provides
    @Singleton
    fun providePropertiesRepository(
        real: PostgrestPropertiesRepository,
        mock: MockPropertiesRepository,
    ): PropertiesRepository = if (BuildConfig.USE_MOCK_DATA) mock else real

    @Provides
    @Singleton
    fun provideAuthRepository(
        real: SupabaseAuthRepository,
        mock: MockAuthRepository,
    ): AuthRepository = if (BuildConfig.USE_MOCK_DATA) mock else real
}
