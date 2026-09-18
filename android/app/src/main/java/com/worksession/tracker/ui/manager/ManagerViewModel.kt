package com.worksession.tracker.ui.manager

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import com.worksession.tracker.data.AuthRepository
import com.worksession.tracker.data.SessionRepository
import com.worksession.tracker.data.models.Task
import com.worksession.tracker.data.models.Worker
import com.worksession.tracker.data.models.WorkerPosition
import com.worksession.tracker.utils.TokenManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class ManagerUiState(
    val isLoading: Boolean               = false,
    val positions: List<WorkerPosition>  = emptyList(),
    val workers: List<Worker>            = emptyList(),
    val tasks: List<Task>                = emptyList(),
    val error: String?                   = null
)

class ManagerViewModel(application: Application) : AndroidViewModel(application) {

    private val tokenManager = TokenManager(application)
    val authRepository       = AuthRepository(tokenManager)
    private val sessionRepo  = SessionRepository()

    private val _uiState     = MutableLiveData(ManagerUiState())
    val uiState: LiveData<ManagerUiState> = _uiState

    private var pollJob: Job? = null

    init {
        refresh()
        startPolling()
    }

    // ── Refresh ───────────────────────────────────────────────────────────────

    fun refresh() {
        viewModelScope.launch {
            _uiState.postValue(_uiState.value?.copy(isLoading = true))
            loadLivePositions()
            loadWorkers()
            loadTasks()
            _uiState.postValue(_uiState.value?.copy(isLoading = false))
        }
    }

    private suspend fun loadLivePositions() {
        val result = sessionRepo.getLivePositions()
        if (result.isSuccess) {
            _uiState.postValue(_uiState.value?.copy(positions = result.getOrDefault(emptyList())))
        }
    }

    private suspend fun loadWorkers() {
        val result = sessionRepo.getWorkers()
        if (result.isSuccess) {
            _uiState.postValue(_uiState.value?.copy(workers = result.getOrDefault(emptyList())))
        }
    }

    private suspend fun loadTasks() {
        val result = sessionRepo.getMyTasks()
        if (result.isSuccess) {
            _uiState.postValue(_uiState.value?.copy(tasks = result.getOrDefault(emptyList())))
        }
    }

    // ── Polling (refresh live positions every 15 s) ───────────────────────────

    private fun startPolling() {
        pollJob?.cancel()
        pollJob = viewModelScope.launch {
            while (isActive) {
                delay(15_000L)
                loadLivePositions()
            }
        }
    }

    // ── Misc ──────────────────────────────────────────────────────────────────

    fun clearError() {
        _uiState.value = _uiState.value?.copy(error = null)
    }

    fun logout() {
        pollJob?.cancel()
        authRepository.logout()
    }

    override fun onCleared() {
        pollJob?.cancel()
        super.onCleared()
    }
}
