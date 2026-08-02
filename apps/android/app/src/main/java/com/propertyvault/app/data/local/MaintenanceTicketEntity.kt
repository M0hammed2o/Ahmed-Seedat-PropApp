package com.propertyvault.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "cached_maintenance_tickets")
data class MaintenanceTicketEntity(
    @PrimaryKey val id: String,
    val orgId: String,
    val propertyId: String,
    val summary: String,
    val description: String?,
    val priority: String,
    val status: String,
    val createdAt: String,
    val fetchedAtEpochMillis: Long,
)
