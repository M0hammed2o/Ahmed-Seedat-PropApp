package com.propertyvault.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface UnitDao {
    @Query("SELECT * FROM cached_units WHERE propertyId = :propertyId ORDER BY unitLabel ASC")
    suspend fun getByProperty(propertyId: String): List<UnitEntity>

    @Query("SELECT * FROM cached_units WHERE id = :id")
    suspend fun getById(id: String): UnitEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(units: List<UnitEntity>)

    @Query("DELETE FROM cached_units WHERE propertyId = :propertyId")
    suspend fun clearByProperty(propertyId: String)

    // Replaces only the given property's cached units -- unlike PropertyDao.replaceAll, this must
    // not wipe every other property's cache, since reads are always scoped to one property.
    @Transaction
    suspend fun replaceForProperty(propertyId: String, units: List<UnitEntity>) {
        clearByProperty(propertyId)
        insertAll(units)
    }
}
