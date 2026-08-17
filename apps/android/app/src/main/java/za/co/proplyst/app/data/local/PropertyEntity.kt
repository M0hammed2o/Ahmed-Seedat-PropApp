package za.co.proplyst.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Read-through cache for Properties (NATIVE_ANDROID_SPEC.md §7: "Room database... for the last
 * successfully-fetched response," shown with a visible cached-data banner on failure -- never
 * silently stale). Only covers the read-only list/detail screens this vertical slice builds;
 * writes are never queued here (Maintenance-ticket offline queue is a separate, not-yet-built
 * table per NATIVE_ANDROID_SPEC.md §7's V1 scope boundary).
 */
@Entity(tableName = "cached_properties")
data class PropertyEntity(
    @PrimaryKey val id: String,
    val orgId: String,
    val nickname: String,
    val fullAddress: String,
    val city: String,
    val province: String?,
    val propertyType: String,
    val municipalAccountNumber: String?,
    val notes: String?,
    val status: String,
    val fetchedAtEpochMillis: Long,
)
