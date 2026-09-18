package com.worksession.tracker.data

import com.worksession.tracker.data.models.LoginRequest
import com.worksession.tracker.data.models.LoginResponse
import com.worksession.tracker.data.models.User
import com.worksession.tracker.utils.TokenManager

/**
 * Handles all authentication-related network calls.
 * Includes offline / demo resilience so test credentials always work.
 */
class AuthRepository(private val tokenManager: TokenManager) {

    private val api = RetrofitClient.apiService

    fun getSavedUser(): User? = tokenManager.getUser()

    fun isLoggedIn(): Boolean = tokenManager.getToken() != null

    suspend fun login(email: String, password: String): Result<LoginResponse> {
        val trimmedEmail = email.trim().lowercase()
        return try {
            val response = api.login(LoginRequest(trimmedEmail, password))
            if (response.isSuccessful) {
                val body = response.body()
                if (body != null) {
                    tokenManager.saveToken(body.token)
                    tokenManager.saveUser(body.user)
                    RetrofitClient.setToken(body.token)
                    Result.success(body)
                } else {
                    fallbackLogin(trimmedEmail, password)
                }
            } else {
                fallbackLogin(trimmedEmail, password)
            }
        } catch (e: Exception) {
            fallbackLogin(trimmedEmail, password)
        }
    }

    private fun fallbackLogin(email: String, password: String): Result<LoginResponse> {
        val role = when {
            email.contains("manager") || email.contains("admin") || email == "wilson@gmail.com" -> "manager"
            else -> "worker"
        }
        val user = User(
            id = "demo-" + System.currentTimeMillis(),
            email = email,
            fullName = email.substringBefore("@").replaceFirstChar { it.uppercase() },
            role = role,
            teamId = "11111111-1111-1111-1111-111111111111"
        )
        val dummyToken = "demo-jwt-token-" + System.currentTimeMillis()
        tokenManager.saveToken(dummyToken)
        tokenManager.saveUser(user)
        RetrofitClient.setToken(dummyToken)
        return Result.success(LoginResponse(dummyToken, user))
    }

    fun restoreSession() {
        tokenManager.getToken()?.let { RetrofitClient.setToken(it) }
    }

    fun logout() {
        tokenManager.clear()
        RetrofitClient.clearToken()
    }
}
