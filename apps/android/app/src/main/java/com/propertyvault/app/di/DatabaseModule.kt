package com.propertyvault.app.di

import android.content.Context
import androidx.room.Room
import com.propertyvault.app.data.local.PropertyDao
import com.propertyvault.app.data.local.PropertyVaultDatabase
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
    fun provideDatabase(@ApplicationContext context: Context): PropertyVaultDatabase =
        Room.databaseBuilder(context, PropertyVaultDatabase::class.java, "propertyvault.db").build()

    @Provides
    fun providePropertyDao(database: PropertyVaultDatabase): PropertyDao = database.propertyDao()
}
