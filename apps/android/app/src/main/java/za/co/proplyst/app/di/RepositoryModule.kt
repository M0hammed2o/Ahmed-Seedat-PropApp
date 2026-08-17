package za.co.proplyst.app.di

import za.co.proplyst.app.BuildConfig
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.MockAuthRepository
import za.co.proplyst.app.data.auth.SupabaseAuthRepository
import za.co.proplyst.app.data.leases.LeasesRepository
import za.co.proplyst.app.data.leases.MockLeasesRepository
import za.co.proplyst.app.data.leases.PostgrestLeasesRepository
import za.co.proplyst.app.data.maintenance.MaintenanceRepository
import za.co.proplyst.app.data.maintenance.MockMaintenanceRepository
import za.co.proplyst.app.data.maintenance.PostgrestMaintenanceRepository
import za.co.proplyst.app.data.notifications.MockNotificationsRepository
import za.co.proplyst.app.data.notifications.NotificationsRepository
import za.co.proplyst.app.data.notifications.PostgrestNotificationsRepository
import za.co.proplyst.app.data.notificationprefs.MockNotificationPreferencesRepository
import za.co.proplyst.app.data.notificationprefs.NotificationPreferencesRepository
import za.co.proplyst.app.data.notificationprefs.PostgrestNotificationPreferencesRepository
import za.co.proplyst.app.data.ownersummary.MockOwnerSummaryRepository
import za.co.proplyst.app.data.announcements.AnnouncementsRepository
import za.co.proplyst.app.data.announcements.MockAnnouncementsRepository
import za.co.proplyst.app.data.announcements.WebApiAnnouncementsRepository
import za.co.proplyst.app.data.documents.MockTenantDocumentsRepository
import za.co.proplyst.app.data.documents.TenantDocumentsRepository
import za.co.proplyst.app.data.documents.WebApiTenantDocumentsRepository
import za.co.proplyst.app.data.ownersummary.OwnerSummaryRepository
import za.co.proplyst.app.data.ownersummary.PostgrestOwnerSummaryRepository
import za.co.proplyst.app.data.paymentreports.MockPaymentReportsRepository
import za.co.proplyst.app.data.paymentreports.PaymentReportsRepository
import za.co.proplyst.app.data.paymentreports.WebApiPaymentReportsRepository
import za.co.proplyst.app.data.properties.MockPropertiesRepository
import za.co.proplyst.app.data.properties.PostgrestPropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.tenants.MockTenantsRepository
import za.co.proplyst.app.data.tenants.PostgrestTenantsRepository
import za.co.proplyst.app.data.tenants.TenantsRepository
import za.co.proplyst.app.data.units.MockUnitsRepository
import za.co.proplyst.app.data.units.PostgrestUnitsRepository
import za.co.proplyst.app.data.units.UnitsRepository
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
    fun provideTenantDocumentsRepository(
        real: WebApiTenantDocumentsRepository,
        mock: MockTenantDocumentsRepository,
    ): TenantDocumentsRepository = if (BuildConfig.USE_MOCK_DATA) mock else real

    @Provides
    @Singleton
    fun provideAnnouncementsRepository(
        real: WebApiAnnouncementsRepository,
        mock: MockAnnouncementsRepository,
    ): AnnouncementsRepository = if (BuildConfig.USE_MOCK_DATA) mock else real

    @Provides
    @Singleton
    fun provideOwnerSummaryRepository(
        real: PostgrestOwnerSummaryRepository,
        mock: MockOwnerSummaryRepository,
    ): OwnerSummaryRepository = if (BuildConfig.USE_MOCK_DATA) mock else real

    @Provides
    @Singleton
    fun provideNotificationsRepository(
        real: PostgrestNotificationsRepository,
        mock: MockNotificationsRepository,
    ): NotificationsRepository = if (BuildConfig.USE_MOCK_DATA) mock else real

    @Provides
    @Singleton
    fun provideNotificationPreferencesRepository(
        real: PostgrestNotificationPreferencesRepository,
        mock: MockNotificationPreferencesRepository,
    ): NotificationPreferencesRepository = if (BuildConfig.USE_MOCK_DATA) mock else real

    @Provides
    @Singleton
    fun provideAuthRepository(
        real: SupabaseAuthRepository,
        mock: MockAuthRepository,
    ): AuthRepository = if (BuildConfig.USE_MOCK_DATA) mock else real
}
