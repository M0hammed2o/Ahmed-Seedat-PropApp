package za.co.proplyst.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface PropertyDao {
    @Query("SELECT * FROM cached_properties ORDER BY nickname ASC")
    suspend fun getAll(): List<PropertyEntity>

    @Query("SELECT * FROM cached_properties WHERE id = :id")
    suspend fun getById(id: String): PropertyEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(properties: List<PropertyEntity>)

    @Query("DELETE FROM cached_properties")
    suspend fun clear()

    @Transaction
    suspend fun replaceAll(properties: List<PropertyEntity>) {
        clear()
        insertAll(properties)
    }
}
