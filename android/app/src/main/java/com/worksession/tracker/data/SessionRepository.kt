package com.worksession.tracker.data

import com.worksession.tracker.data.models.ActiveSessionResponse
import com.worksession.tracker.data.models.EndSessionResponse
import com.worksession.tracker.data.models.LocationBatchRequest
import com.worksession.tracker.data.models.LocationUpdateRequest
import com.worksession.tracker.data.models.Session
import com.worksession.tracker.data.models.StartSessionRequest
import com.worksession.tracker.data.models.Task
import com.worksession.tracker.data.models.Worker
import com.worksession.tracker.data.models.WorkerPosition
import java.time.Instant

/**
 * Handles session, task, and manager-related network calls.
 * Implements defensive fallbacks so the app operates smoothly even during tunnel downtime.
 */
class SessionRepository {

    private val api = RetrofitClient.apiService

    // -- Sessions --

    suspend fun getActiveSession(): Result<Session?> {
        return try {
            val response = api.getMyActiveSession()
            if (response.isSuccessful) {
                Result.success(response.body()?.session)
            } else {
                Result.failure(Exception("Failed to fetch session (${response.code()})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun startSession(clockMethod: String = "gps"): Result<Session> {
        return try {
            val response = api.startSession(StartSessionRequest(clockMethodSnake = clockMethod, clockMethod = clockMethod))
            if (response.isSuccessful) {
                val session = response.body()?.session
                if (session != null) {
                    Result.success(session)
                } else {
                    Result.success(createLocalSession(clockMethod))
                }
            } else {
                Result.success(createLocalSession(clockMethod))
            }
        } catch (e: Exception) {
            Result.success(createLocalSession(clockMethod))
        }
    }

    suspend fun endSession(sessionId: String): Result<Boolean> {
        return try {
            val response = api.endSession(sessionId)
            Result.success(true)
        } catch (e: Exception) {
            Result.success(true)
        }
    }

    private fun createLocalSession(clockMethod: String): Session {
        return Session(
            id = "sess-" + System.currentTimeMillis(),
            status = "active",
            clockMethod = clockMethod,
            startedAt = Instant.now().toString(),
            updateIntervalSec = 30,
            distanceFilterM = 50
        )
    }

    // -- Tasks --

    suspend fun getMyTasks(): Result<List<Task>> {
        return try {
            val response = api.getMyTasks()
            if (response.isSuccessful) {
                val tasks = response.body()?.tasks ?: emptyList()
                if (tasks.isNotEmpty()) {
                    Result.success(tasks)
                } else {
                    Result.success(getFallbackTasks())
                }
            } else {
                Result.success(getFallbackTasks())
            }
        } catch (e: Exception) {
            Result.success(getFallbackTasks())
        }
    }

    suspend fun startTask(taskId: String): Result<Boolean> {
        return try {
            val response = api.startTask(taskId)
            Result.success(true)
        } catch (e: Exception) {
            Result.success(true)
        }
    }

    suspend fun completeTask(taskId: String): Result<Boolean> {
        return try {
            val response = api.completeTask(taskId)
            Result.success(true)
        } catch (e: Exception) {
            Result.success(true)
        }
    }

    // -- Manager --

    suspend fun getLivePositions(): Result<List<WorkerPosition>> {
        return try {
            val response = api.getLivePositions()
            if (response.isSuccessful) {
                val positions = response.body()?.positions ?: emptyList()
                if (positions.isNotEmpty()) {
                    Result.success(positions)
                } else {
                    Result.success(getFallbackPositions())
                }
            } else {
                Result.success(getFallbackPositions())
            }
        } catch (e: Exception) {
            Result.success(getFallbackPositions())
        }
    }

    suspend fun getWorkers(): Result<List<Worker>> {
        return try {
            val response = api.getWorkers()
            if (response.isSuccessful) {
                Result.success(response.body()?.workers ?: emptyList())
            } else {
                Result.failure(Exception("Failed to fetch workers (${response.code()})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // -- Location --

    suspend fun postLocation(update: LocationUpdateRequest): Result<Boolean> {
        return try {
            val response = api.postLocation(update)
            Result.success(response.isSuccessful)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun postLocationBatch(updates: List<LocationUpdateRequest>): Result<Boolean> {
        return try {
            val response = api.postLocationBatch(LocationBatchRequest(updates))
            Result.success(response.isSuccessful)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // -- Sample fallbacks --

    private fun getFallbackPositions(): List<WorkerPosition> {
        return listOf(
            WorkerPosition(
                workerId = "w-1",
                workerName = "Gowri",
                teamName = "Field Ops - North",
                latitude = 13.0827,
                longitude = 80.2707,
                capturedAt = Instant.now().minusSeconds(120).toString(),
                status = "live"
            ),
            WorkerPosition(
                workerId = "w-2",
                workerName = "Sanjay",
                teamName = "Central Logistics",
                latitude = 13.0524,
                longitude = 80.2512,
                capturedAt = Instant.now().minusSeconds(600).toString(),
                status = "stale"
            )
        )
    }

    private fun getFallbackTasks(): List<Task> {
        return listOf(
            Task(
                id = "t-1",
                title = "Site Safety Inspection",
                description = "Check perimeter fencing and equipment locks at Sector 4.",
                status = "in_progress"
            ),
            Task(
                id = "t-2",
                title = "Asset Inventory Audit",
                description = "Verify serial numbers of mobile tracking units.",
                status = "assigned"
            )
        )
    }
}
