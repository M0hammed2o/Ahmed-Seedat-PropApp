package za.co.proplyst.app.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Read-through cache for Units, same purpose/scope boundary as PropertyEntity. Indexed on
 * propertyId since every read is scoped to one property, never the whole table. */
@Entity(tableName = "cached_units", indices = [Index("propertyId")])
data class UnitEntity(
    @PrimaryKey val id: String,
    val propertyId: String,
    val orgId: String,
    val unitLabel: String,
    val bedrooms: Int?,
    val bathrooms: Int?,
    val sizeSqm: Double?,
    val marketRent: Double?,
    val status: String,
    val fetchedAtEpochMillis: Long,
)
