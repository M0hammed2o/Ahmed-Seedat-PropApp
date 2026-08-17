package com.propertyvault.app.di

import com.propertyvault.app.BuildConfig
import com.propertyvault.app.data.auth.AuthRepository
import com.propertyvault.app.data.auth.MockAuthRepository
import com.propertyvault.app.data.auth.SupabaseAuthRepository
import com.propertyvault.app.data.leases.LeasesRepository
import com.propertyvault.app.data.leases.MockLeasesRepository
import com.propertyvault.app.data.leases.PostgrestLeasesRepository
import com.propertyvault.app.data.maintenance.MaintenanceRepository
import com.propertyvault.app.data.maintenance.MockMaintenanceRepository
import com.propertyvault.app.data.maintenance.PostgrestMaintenanceRepository
import com.propertyvault.app.data.paymentreports.MockPaymentReportsRepository
import com.propertyvault.app.data.paymentreports.PaymentReportsRepository
import com.propertyvault.app.data.paymentreports.WebApiPaymentReportsRepository
import com.propertyvault.app.data.properties.MockPropertiesRepository
import com.propertyvault.app.data.properties.PostgrestPropertiesRepository
import com.propertyvault.app.data.properties.PropertiesRepository
import com.propertyvault.app.data.tenants.MockTenantsRepository
import com.propertyvault.app.data.tenants.PostgrestTenantsRepository
import com.propertyvault.app.data.tenants.TenantsRepository
import com.propertyvault.app.data.units.MockUnitsRepository
import com.propertyvault.app.data.units.PostgrestUnitsRepository
import com.propertyvault.app.data.units.UnitsRepository
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
    fun provideUnitsRepository(
        real: PostgrestUnitsRepository,
        mock: MockUnitsRepository,
    ): UnitsRepository = if (BuildConfig.USE_MOCK_DATA) mock else real

    @Provides
    @Singleton
    fun provideTenantsRepository(
        real: PostgrestTenantsRepository,
        mock: MockTenantsRepository,
    ): TenantsRepository = if (BuildConfig.USE_MOCK_DATA) mock else real

    @Provides
    @Singleton
    fun provideLeasesRepository(
        real: PostgrestLeasesRepository,
        mock: MockLeasesRepository,
    ): LeasesRepository = if (BuildConfig.USE_MOCK_DATA) mock else real

    @Provides
    @Singleton
    fun provideMaintenanceRepository(
        real: PostgrestMaintenanceRepository,
        mock: MockMaintenanceRepository,
    ): MaintenanceRepository = if (BuildConfig.USE_MOCK_DATA) mock else real

    @Provides
    @Singleton
    fun providePaymentReportsRepository(
        real: WebApiPaymentReportsRepository,
        mock: MockPaymentReportsRepository,
    ): PaymentReportsRepository = if (BuildConfig.USE_MOCK_DATA) mock else real

    @Provides
    @Singleton
    fun provideAuthRepository(
        real: SupabaseAuthRepository,
        mock: MockAuthRepository,
    ): AuthRepository = if (BuildConfig.USE_MOCK_DATA) mock else real
}
