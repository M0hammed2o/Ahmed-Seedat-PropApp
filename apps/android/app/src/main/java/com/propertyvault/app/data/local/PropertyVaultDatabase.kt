package com.propertyvault.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

// version 2 (was 1): added cached_units. No migration path written -- this is a read-through
// cache only, never a source of truth (PropertyEntity's own doc comment), so losing cached rows on
// a schema bump just means the next read re-fetches from the network; DatabaseModule wires
// fallbackToDestructiveMigration() rather than a hand-written Migration for that reason.
@Database(entities = [PropertyEntity::class, UnitEntity::class], version = 2, exportSchema = true)
abstract class PropertyVaultDatabase : RoomDatabase() {
    abstract fun propertyDao(): PropertyDao
    abstract fun unitDao(): UnitDao
}
