package com.propertyvault.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface LeaseDao {
    @Query("SELECT * FROM cached_leases WHERE unitId = :unitId ORDER BY startDate DESC")
    suspend fun getByUnit(unitId: String): List<LeaseEntity>

    @Query("SELECT * FROM cached_leases WHERE id = :id")
    suspend fun getById(id: String): LeaseEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(leases: List<LeaseEntity>)

    @Query("DELETE FROM cached_leases WHERE unitId = :unitId")
    suspend fun clearByUnit(unitId: String)

    @Transaction
    suspend fun replaceForUnit(unitId: String, leases: List<LeaseEntity>) {
        clearByUnit(unitId)
        insertAll(leases)
    }
}
