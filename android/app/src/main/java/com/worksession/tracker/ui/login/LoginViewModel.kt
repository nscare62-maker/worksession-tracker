package com.worksession.tracker.ui.login

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import com.worksession.tracker.data.AuthRepository
import com.worksession.tracker.data.models.User
import com.worksession.tracker.utils.TokenManager
import kotlinx.coroutines.launch

data class LoginUiState(
    val isLoading: Boolean = false,
    val error: String?     = null,
    val user: User?        = null
)

class LoginViewModel(application: Application) : AndroidViewModel(application) {

    private val tokenManager = TokenManager(application)
    val authRepository = AuthRepository(tokenManager)

    private val _uiState = MutableLiveData(LoginUiState())
    val uiState: LiveData<LoginUiState> = _uiState

    fun login(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) {
            _uiState.value = LoginUiState(error = "Please enter your email and password")
            return
        }
        _uiState.value = LoginUiState(isLoading = true)
        viewModelScope.launch {
            val result = authRepository.login(email.trim(), password)
            _uiState.postValue(
                if (result.isSuccess) {
                    LoginUiState(user = result.getOrNull()?.user)
                } else {
                    LoginUiState(error = result.exceptionOrNull()?.message ?: "Login failed")
                }
            )
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value?.copy(error = null)
    }
}
