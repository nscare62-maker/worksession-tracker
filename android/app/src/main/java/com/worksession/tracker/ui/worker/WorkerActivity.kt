package com.worksession.tracker.ui.worker

import android.Manifest
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import android.os.Bundle
import android.os.Looper
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.worksession.tracker.R
import com.worksession.tracker.databinding.ActivityWorkerBinding
import com.worksession.tracker.service.LocationService
import com.worksession.tracker.ui.login.LoginActivity
import com.worksession.tracker.ui.manager.ManagerActivity
import com.worksession.tracker.utils.isVisible
import com.worksession.tracker.utils.startActivity
import com.worksession.tracker.utils.toHhMmSs
import com.worksession.tracker.utils.toast

class WorkerActivity : AppCompatActivity() {

    private lateinit var binding: ActivityWorkerBinding
    private val viewModel: WorkerViewModel by viewModels()

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var locationCallback: LocationCallback? = null

    private val taskAdapter = TaskAdapter(
        onStart    = { task -> viewModel.startTask(task.id) },
        onComplete = { task -> viewModel.completeTask(task.id) }
    )

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineGranted   = permissions[Manifest.permission.ACCESS_FINE_LOCATION]   == true
        val coarseGranted = permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (fineGranted || coarseGranted) {
            startPassiveLocationUpdates()
        } else {
            binding.tvGpsStatus.text = "Denied"
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityWorkerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        setupUserHeader()
        setupRecyclerView()
        observeViewModel()
        setupClickListeners()
        requestLocationPermissions()
    }

    override fun onResume() {
        super.onResume()
        setupUserHeader()
        viewModel.loadActiveSession()
        viewModel.loadTasks()
    }

    override fun onDestroy() {
        stopPassiveLocationUpdates()
        super.onDestroy()
    }

    private fun setupUserHeader() {
        val user = viewModel.authRepository.getSavedUser()
        val name = user?.name ?: "Worker"
        binding.tvGreeting.text = "Hi, $name ⚡"
        binding.tvRoleAndName.text = "EMPLOYEE • ${name.uppercase()}"
    }

    private fun setupRecyclerView() {
        binding.rvTasks.apply {
            adapter       = taskAdapter
            layoutManager = LinearLayoutManager(this@WorkerActivity)
        }
    }

    private fun setupClickListeners() {
        binding.btnPunchInOut.setOnClickListener {
            val session = viewModel.uiState.value?.session
            if (session == null) {
                viewModel.punchIn()
            } else {
                viewModel.punchOut()
                stopLocationService()
            }
        }

        binding.btnManagerMode.setOnClickListener {
            startActivity<ManagerActivity>()
        }

        binding.btnLogout.setOnClickListener {
            viewModel.logout()
            stopLocationService()
            startActivity<LoginActivity>(clearStack = true)
        }

        binding.swipeRefreshTasks.setOnRefreshListener {
            viewModel.loadTasks()
        }
    }

    private fun observeViewModel() {
        viewModel.uiState.observe(this) { state ->
            binding.progressBar.isVisible          = state.isLoading
            binding.btnPunchInOut.isEnabled         = !state.isLoading
            binding.swipeRefreshTasks.isRefreshing  = false

            // Active vs Inactive Styling matching GeoWorkers web panel
            if (state.session != null) {
                binding.cardSession.setBackgroundResource(R.drawable.bg_card_active)
                binding.btnPunchInOut.setBackgroundResource(R.drawable.bg_btn_red)
                binding.btnPunchInOut.text = "⏹  Punch Out"
                binding.btnPunchInOut.setTextColor(getColor(R.color.white))
                binding.tvElapsedTime.setTextColor(getColor(R.color.status_live))
                binding.tvElapsedTime.text = state.elapsedSeconds.toHhMmSs()
                binding.tvSessionStatus.text = "● Shift Active"
                binding.tvSessionStatus.setTextColor(getColor(R.color.status_live))
                binding.tvTrackingStatus.isVisible = true
                startLocationService(state.session.id)
            } else {
                binding.cardSession.setBackgroundResource(R.drawable.bg_card_dark)
                binding.btnPunchInOut.setBackgroundResource(R.drawable.bg_btn_green)
                binding.btnPunchInOut.text = "▶  Punch In"
                binding.btnPunchInOut.setTextColor(getColor(R.color.black))
                binding.tvElapsedTime.setTextColor(getColor(R.color.text_secondary))
                binding.tvElapsedTime.text = "00:00:00"
                binding.tvSessionStatus.text = "○ Not clocked in"
                binding.tvSessionStatus.setTextColor(getColor(R.color.text_muted))
                binding.tvTrackingStatus.isVisible = false
            }

            // GPS accuracy chip
            binding.tvGpsAccuracy.isVisible = state.gpsAccuracyM != null
            state.gpsAccuracyM?.let {
                binding.tvGpsAccuracy.text = "±%.1fm".format(it)
            }

            // Tasks
            taskAdapter.submitList(state.tasks)
            binding.tvNoTasks.isVisible = state.tasks.isEmpty() && !state.isLoading
            binding.tvTaskCountBadge.text = "${state.tasks.size} TASKS"

            // Toast messages
            state.message?.let {
                toast(it)
                viewModel.clearMessage()
            }
            state.error?.let {
                toast(it, long = true)
                viewModel.clearError()
            }
        }
    }

    private fun startLocationService(sessionId: String) {
        val fineGranted   = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarseGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fineGranted && !coarseGranted) {
            requestLocationPermissions()
            return
        }
        try {
            val intent = LocationService.startIntent(this, sessionId)
            ContextCompat.startForegroundService(this, intent)
        } catch (e: Throwable) {
            toast("Location service: ${e.message}")
        }
    }

    private fun stopLocationService() {
        startService(LocationService.stopIntent(this))
    }

    private fun requestLocationPermissions() {
        val fine   = Manifest.permission.ACCESS_FINE_LOCATION
        val coarse = Manifest.permission.ACCESS_COARSE_LOCATION
        val fineGranted   = ContextCompat.checkSelfPermission(this, fine) == PackageManager.PERMISSION_GRANTED
        val coarseGranted = ContextCompat.checkSelfPermission(this, coarse) == PackageManager.PERMISSION_GRANTED
        if (fineGranted || coarseGranted) {
            startPassiveLocationUpdates()
        } else {
            val permissions = mutableListOf(fine, coarse)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            }
            locationPermissionLauncher.launch(permissions.toTypedArray())
        }
    }

    private fun startPassiveLocationUpdates() {
        try {
            val request = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 10_000L)
                .setMinUpdateIntervalMillis(5_000L)
                .build()

            locationCallback = object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    result.lastLocation?.let { updateGpsUi(it) }
                }
            }

            fusedLocationClient.requestLocationUpdates(
                request,
                locationCallback!!,
                Looper.getMainLooper()
            )
        } catch (_: SecurityException) { }
    }

    private fun stopPassiveLocationUpdates() {
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        locationCallback = null
    }

    private fun updateGpsUi(location: Location) {
        val accuracy = if (location.hasAccuracy()) location.accuracy else null
        viewModel.updateGpsAccuracy(accuracy)
        val status = when {
            accuracy == null  -> "Acquiring..."
            accuracy <= 15f   -> "Live (±%.0fm)".format(accuracy)
            accuracy <= 50f   -> "Good (±%.0fm)".format(accuracy)
            else              -> "Fair (±%.0fm)".format(accuracy)
        }
        binding.tvGpsStatus.text = status
    }
}