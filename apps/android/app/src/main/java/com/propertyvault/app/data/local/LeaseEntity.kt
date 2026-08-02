package com.propertyvault.app.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "cached_leases", indices = [Index("unitId")])
data class LeaseEntity(
    @PrimaryKey val id: String,
    val orgId: String,
    val unitId: String,
    val startDate: String,
    val endDate: String?,
    val rentAmount: Double,
    val rentFrequency: String,
    val depositAmount: Double,
    val status: String,
    val fetchedAtEpochMillis: Long,
)
