package com.propertyvault.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

// version 3 (was 2): added cached_tenants. Same fallbackToDestructiveMigration() rationale as the
// version 1 -> 2 bump -- read-through cache only, never a source of truth.
@Database(
    entities = [PropertyEntity::class, UnitEntity::class, TenantEntity::class],
    version = 3,
    exportSchema = true,
)
abstract class PropertyVaultDatabase : RoomDatabase() {
    abstract fun propertyDao(): PropertyDao
    abstract fun unitDao(): UnitDao
    abstract fun tenantDao(): TenantDao
}
