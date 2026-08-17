package za.co.proplyst.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "cached_tenants")
data class TenantEntity(
    @PrimaryKey val id: String,
    val orgId: String,
    val fullName: String,
    val email: String?,
    val phone: String?,
    val status: String,
    val fetchedAtEpochMillis: Long,
)
