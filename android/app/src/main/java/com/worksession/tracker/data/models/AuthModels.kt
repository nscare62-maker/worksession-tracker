package com.worksession.tracker.data.models

import com.google.gson.annotations.SerializedName

data class LoginRequest(
    val email: String,
    val password: String
)

data class LoginResponse(
    val token: String,
    val user: User
)

data class User(
    val id: String = "",
    val email: String = "",
    @SerializedName("fullName") val fullName: String? = null,
    @SerializedName("full_name") val fullNameSnake: String? = null,
    val role: String = "worker",       // "worker" | "manager" | "admin"
    val teamId: String? = null,
    @SerializedName("team_id") val teamIdSnake: String? = null
) {
    val name: String
        get() = fullName ?: fullNameSnake ?: email.substringBefore("@")
}

data class ConsentStatusResponse(
    val required: Boolean = false,
    val policyTextHash: String? = null,
    val acknowledgedAt: String? = null
)

data class ConsentAcknowledgeRequest(
    val policyTextHash: String
)
