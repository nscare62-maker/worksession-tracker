package com.worksession.tracker.data

import com.worksession.tracker.data.models.ActiveSessionResponse
import com.worksession.tracker.data.models.ConsentAcknowledgeRequest
import com.worksession.tracker.data.models.ConsentStatusResponse
import com.worksession.tracker.data.models.EndSessionResponse
import com.worksession.tracker.data.models.LivePositionsResponse
import com.worksession.tracker.data.models.LocationBatchRequest
import com.worksession.tracker.data.models.LocationUpdateRequest
import com.worksession.tracker.data.models.LocationUpdateResponse
import com.worksession.tracker.data.models.LoginRequest
import com.worksession.tracker.data.models.LoginResponse
import com.worksession.tracker.data.models.StartSessionRequest
import com.worksession.tracker.data.models.StartSessionResponse
import com.worksession.tracker.data.models.TasksResponse
import com.worksession.tracker.data.models.WorkersResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface ApiService {

    // -- Auth --

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @GET("auth/consent")
    suspend fun getConsentStatus(): Response<ConsentStatusResponse>

    @POST("auth/consent")
    suspend fun acknowledgeConsent(@Body request: ConsentAcknowledgeRequest): Response<Any>

    // -- Sessions --

    @GET("sessions/mine/active")
    suspend fun getMyActiveSession(): Response<ActiveSessionResponse>

    @POST("sessions/start")
    suspend fun startSession(@Body request: StartSessionRequest): Response<StartSessionResponse>

    @POST("sessions/{id}/end")
    suspend fun endSession(@Path("id") sessionId: String): Response<EndSessionResponse>

    // -- Locations --

    @POST("locations")
    suspend fun postLocation(@Body request: LocationUpdateRequest): Response<LocationUpdateResponse>

    @POST("locations/batch")
    suspend fun postLocationBatch(@Body request: LocationBatchRequest): Response<LocationUpdateResponse>

    // -- Tasks --

    @GET("tasks/mine")
    suspend fun getMyTasks(): Response<TasksResponse>

    @POST("tasks/{id}/start")
    suspend fun startTask(@Path("id") taskId: String): Response<Any>

    @POST("tasks/{id}/complete")
    suspend fun completeTask(@Path("id") taskId: String): Response<Any>

    // -- Manager --

    @GET("manager/positions/live")
    suspend fun getLivePositions(): Response<LivePositionsResponse>

    @GET("manager/workers")
    suspend fun getWorkers(): Response<WorkersResponse>
}
