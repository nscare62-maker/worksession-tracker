package com.worksession.tracker.data.models

import com.google.gson.annotations.SerializedName
import com.worksession.tracker.utils.parseSecondsAgo

data class Session(
    val id: String = "",
    val status: String = "active",          // "active" | "ended" | "force_ended"
    @SerializedName("clock_method") val clockMethod: String? = "gps",
    @SerializedName("started_at") val startedAt: String? = null,
    @SerializedName("update_interval_sec") val updateIntervalSec: Int? = 30,
    @SerializedName("distance_filter_m") val distanceFilterM: Int? = 50
)

data class ActiveSessionResponse(
    val session: Session? = null
)

data class StartSessionRequest(
    @SerializedName("clock_method") val clockMethodSnake: String = "gps",
    val clockMethod: String = "gps"
)

data class StartSessionResponse(
    val session: Session? = null
)

data class EndSessionResponse(
    val ok: Boolean = true
)

data class Task(
    val id: String = "",
    val title: String? = "Task",
    val description: String? = null,
    val status: String? = "assigned",          // "assigned" | "pending" | "in_progress" | "completed"
    @SerializedName("due_at") val dueAt: String? = null,
    @SerializedName("session_id") val sessionId: String? = null,
    @SerializedName("assigned_to") val assignedTo: String? = null,
    @SerializedName("assigner_name") val assignerName: String? = null
)

data class TasksResponse(
    val tasks: List<Task>? = null
)

data class WorkerPosition(
    @SerializedName("worker_id") val workerId: String = "",
    @SerializedName("worker_name") val workerName: String? = null,
    @SerializedName("team_name") val teamName: String? = null,
    val team: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    @SerializedName("captured_at") val capturedAt: String? = null,
    @SerializedName("updated_at") val updatedAt: String? = null,
    val status: String? = null          // "live" | "stale" | "offline"
) {
    val displayWorkerName: String
        get() = workerName ?: "Worker"

    val displayTeam: String
        get() = teamName ?: team ?: "Field Operations"

    val displayTime: String?
        get() = capturedAt ?: updatedAt

    val calculatedStatus: String
        get() {
            if (!status.isNullOrBlank()) return status.lowercase()
            val timeStr = displayTime ?: return "offline"
            val diffSec = parseSecondsAgo(timeStr)
            return when {
                diffSec == null -> "offline"
                diffSec < 300   -> "live"
                diffSec < 3600  -> "stale"
                else            -> "offline"
            }
        }
}

data class LivePositionsResponse(
    val positions: List<WorkerPosition>? = null
)

data class Worker(
    val id: String = "",
    val email: String = "",
    @SerializedName("full_name") val fullName: String? = null,
    val role: String = "worker",
    @SerializedName("team_id") val teamId: String? = null,
    @SerializedName("team_name") val teamName: String? = null
)

data class WorkersResponse(
    val workers: List<Worker>? = null
)
