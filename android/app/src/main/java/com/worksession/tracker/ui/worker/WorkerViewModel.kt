package com.worksession.tracker.ui.worker

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import com.worksession.tracker.data.AuthRepository
import com.worksession.tracker.data.SessionRepository
import com.worksession.tracker.data.models.Session
import com.worksession.tracker.data.models.Task
import com.worksession.tracker.utils.TokenManager
import com.worksession.tracker.utils.parseToInstant
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant

data class WorkerUiState(
    val isLoading: Boolean     = false,
    val session: Session?      = null,
    val tasks: List<Task>      = emptyList(),
    val elapsedSeconds: Long   = 0L,
    val gpsAccuracyM: Float?   = null,
    val isTrackingActive: Boolean = false,
    val error: String?         = null,
    val message: String?       = null
)

class WorkerViewModel(application: Application) : AndroidViewModel(application) {

    private val tokenManager    = TokenManager(application)
    val authRepository          = AuthRepository(tokenManager)
    private val sessionRepo     = SessionRepository()

    private val _uiState        = MutableLiveData(WorkerUiState())
    val uiState: LiveData<WorkerUiState> = _uiState

    private var timerJob: Job?  = null

    init {
        loadActiveSession()
        loadTasks()
    }

    // -- Session --

    fun loadActiveSession() {
        viewModelScope.launch {
            _uiState.postValue(_uiState.value?.copy(isLoading = true))
            val result = sessionRepo.getActiveSession()
            val session = result.getOrNull()
            _uiState.postValue(
                _uiState.value?.copy(
                    isLoading       = false,
                    session         = session,
                    isTrackingActive = session != null,
                    error           = null
                )
            )
            session?.let { startTimer(it.startedAt) }
        }
    }

    fun punchIn() {
        _uiState.value = _uiState.value?.copy(isLoading = true)
        viewModelScope.launch {
            val result = sessionRepo.startSession("gps")
            val session = result.getOrNull()
            if (result.isSuccess && session != null) {
                _uiState.postValue(
                    _uiState.value?.copy(
                        isLoading        = false,
                        session          = session,
                        isTrackingActive = true,
                        message          = "Punched in successfully"
                    )
                )
                startTimer(session.startedAt)
            } else {
                _uiState.postValue(
                    _uiState.value?.copy(
                        isLoading = false,
                        error     = result.exceptionOrNull()?.message ?: "Punch in failed"
                    )
                )
            }
        }
    }

    fun punchOut() {
        val sessionId = _uiState.value?.session?.id ?: return
        _uiState.value = _uiState.value?.copy(isLoading = true)
        viewModelScope.launch {
            val result = sessionRepo.endSession(sessionId)
            if (result.isSuccess) {
                stopTimer()
                _uiState.postValue(
                    WorkerUiState(
                        isLoading        = false,
                        session          = null,
                        isTrackingActive = false,
                        message          = "Punched out successfully"
                    )
                )
            } else {
                _uiState.postValue(
                    _uiState.value?.copy(
                        isLoading = false,
                        error     = result.exceptionOrNull()?.message ?: "Punch out failed"
                    )
                )
            }
        }
    }

    // -- Tasks --

    fun loadTasks() {
        viewModelScope.launch {
            val result = sessionRepo.getMyTasks()
            if (result.isSuccess) {
                _uiState.postValue(_uiState.value?.copy(tasks = result.getOrDefault(emptyList())))
            }
        }
    }

    fun startTask(taskId: String) {
        viewModelScope.launch {
            sessionRepo.startTask(taskId)
            loadTasks()
        }
    }

    fun completeTask(taskId: String) {
        viewModelScope.launch {
            sessionRepo.completeTask(taskId)
            loadTasks()
        }
    }

    // -- GPS accuracy update (called from Activity) --

    fun updateGpsAccuracy(accuracyM: Float?) {
        _uiState.value = _uiState.value?.copy(gpsAccuracyM = accuracyM)
    }

    // -- Timer --

    private fun startTimer(startedAt: String?) {
        stopTimer()
        val startEpoch = parseToInstant(startedAt)?.epochSecond ?: Instant.now().epochSecond
        timerJob = viewModelScope.launch {
            while (true) {
                val elapsed = maxOf(0L, Instant.now().epochSecond - startEpoch)
                _uiState.postValue(_uiState.value?.copy(elapsedSeconds = elapsed))
                delay(1_000L)
            }
        }
    }

    private fun stopTimer() {
        timerJob?.cancel()
        timerJob = null
    }

    // -- Misc --

    fun clearMessage() {
        _uiState.value = _uiState.value?.copy(message = null)
    }

    fun clearError() {
        _uiState.value = _uiState.value?.copy(error = null)
    }

    fun logout() {
        stopTimer()
        authRepository.logout()
    }

    override fun onCleared() {
        stopTimer()
        super.onCleared()
    }
}
