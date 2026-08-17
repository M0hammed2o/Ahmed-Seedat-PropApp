package za.co.proplyst.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface MaintenanceTicketDao {
    @Query("SELECT * FROM cached_maintenance_tickets ORDER BY createdAt DESC")
    suspend fun getAll(): List<MaintenanceTicketEntity>

    @Query("SELECT * FROM cached_maintenance_tickets WHERE id = :id")
    suspend fun getById(id: String): MaintenanceTicketEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(tickets: List<MaintenanceTicketEntity>)

    @Query("DELETE FROM cached_maintenance_tickets")
    suspend fun clear()

    @Transaction
    suspend fun replaceAll(tickets: List<MaintenanceTicketEntity>) {
        clear()
        insertAll(tickets)
    }
}
