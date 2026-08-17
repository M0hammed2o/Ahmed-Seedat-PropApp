package za.co.proplyst.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

// version 5 (was 4): added cached_maintenance_tickets. Same fallbackToDestructiveMigration()
// rationale as every prior bump -- read-through cache only, never a source of truth.
@Database(
    entities = [
        PropertyEntity::class,
        UnitEntity::class,
        TenantEntity::class,
        LeaseEntity::class,
        MaintenanceTicketEntity::class,
    ],
    version = 5,
    exportSchema = true,
)
abstract class ProplystDatabase : RoomDatabase() {
    abstract fun propertyDao(): PropertyDao
    abstract fun unitDao(): UnitDao
    abstract fun tenantDao(): TenantDao
    abstract fun leaseDao(): LeaseDao
    abstract fun maintenanceTicketDao(): MaintenanceTicketDao
}
