package com.worksession.tracker.data.models

import com.google.gson.annotations.SerializedName

data class LocationUpdateRequest(
    val sessionId: String,
    val latitude: Double,
    val longitude: Double,
    @SerializedName("accuracyM") val accuracyM: Float?,
    @SerializedName("speedMps") val speedMps: Float?,
    @SerializedName("headingDeg") val headingDeg: Float?,
    val capturedAt: String,
    val updateType: String = "interval"   // "interval" | "distance" | "manual_ping"
)

data class LocationUpdateResponse(
    val ok: Boolean
)

data class LocationBatchRequest(
    val updates: List<LocationUpdateRequest>
)
