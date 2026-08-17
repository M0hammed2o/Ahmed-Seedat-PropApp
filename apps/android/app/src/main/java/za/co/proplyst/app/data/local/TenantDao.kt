package za.co.proplyst.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface TenantDao {
    @Query("SELECT * FROM cached_tenants ORDER BY fullName ASC")
    suspend fun getAll(): List<TenantEntity>

    @Query("SELECT * FROM cached_tenants WHERE id = :id")
    suspend fun getById(id: String): TenantEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(tenants: List<TenantEntity>)

    @Query("DELETE FROM cached_tenants")
    suspend fun clear()

    @Transaction
    suspend fun replaceAll(tenants: List<TenantEntity>) {
        clear()
        insertAll(tenants)
    }
}
