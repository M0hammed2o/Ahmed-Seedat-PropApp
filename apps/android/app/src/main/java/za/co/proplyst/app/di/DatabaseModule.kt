package za.co.proplyst.app.di

import android.content.Context
import androidx.room.Room
import za.co.proplyst.app.data.local.LeaseDao
import za.co.proplyst.app.data.local.MaintenanceTicketDao
import za.co.proplyst.app.data.local.PropertyDao
import za.co.proplyst.app.data.local.ProplystDatabase
import za.co.proplyst.app.data.local.TenantDao
import za.co.proplyst.app.data.local.UnitDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {
    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): ProplystDatabase =
        Room.databaseBuilder(context, ProplystDatabase::class.java, "propertyvault.db")
            .fallbackToDestructiveMigration()
            .build()

    @Provides
    fun providePropertyDao(database: ProplystDatabase): PropertyDao = database.propertyDao()

    @Provides
    fun provideUnitDao(database: ProplystDatabase): UnitDao = database.unitDao()

    @Provides
    fun provideTenantDao(database: ProplystDatabase): TenantDao = database.tenantDao()

    @Provides
    fun provideLeaseDao(database: ProplystDatabase): LeaseDao = database.leaseDao()

    @Provides
    fun provideMaintenanceTicketDao(database: ProplystDatabase): MaintenanceTicketDao =
        database.maintenanceTicketDao()
}
