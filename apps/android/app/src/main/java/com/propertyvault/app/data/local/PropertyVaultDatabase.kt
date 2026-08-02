package com.propertyvault.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

// version 4 (was 3): added cached_leases. Same fallbackToDestructiveMigration() rationale as every
// prior bump -- read-through cache only, never a source of truth.
@Database(
    entities = [PropertyEntity::class, UnitEntity::class, TenantEntity::class, LeaseEntity::class],
    version = 4,
    exportSchema = true,
)
abstract class PropertyVaultDatabase : RoomDatabase() {
    abstract fun propertyDao(): PropertyDao
    abstract fun unitDao(): UnitDao
    abstract fun tenantDao(): TenantDao
    abstract fun leaseDao(): LeaseDao
}
