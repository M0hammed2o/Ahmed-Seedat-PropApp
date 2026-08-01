package com.propertyvault.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(entities = [PropertyEntity::class], version = 1, exportSchema = true)
abstract class PropertyVaultDatabase : RoomDatabase() {
    abstract fun propertyDao(): PropertyDao
}
