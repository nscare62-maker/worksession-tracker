package com.worksession.tracker.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.worksession.tracker.R
import com.worksession.tracker.data.RetrofitClient
import com.worksession.tracker.data.models.LocationUpdateRequest
import com.worksession.tracker.ui.worker.WorkerActivity
import com.worksession.tracker.utils.nowIso
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Foreground service that posts GPS coordinates to the backend every 30 seconds
 * while a work session is active.
 *
 * Start with [ACTION_START] and the session ID extra.
 * Stop with [ACTION_STOP].
 */
class LocationService : Service() {

    // â”€â”€ Coroutine scope tied to service lifetime â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // â”€â”€ Fused location client â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var locationCallback: LocationCallback? = null

    // â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    private var sessionId: String? = null
    private var lastLocation: Location? = null

    // â”€â”€ Service lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val sid = intent.getStringExtra(EXTRA_SESSION_ID)
                if (sid.isNullOrBlank()) {
                    Log.w(TAG, "Start requested without session ID, ignoring")
                    stopSelf()
                    return START_NOT_STICKY
                }
                sessionId = sid
                val notification = buildNotification()
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
                    } else {
                        startForeground(NOTIFICATION_ID, notification)
                    }
                    startLocationUpdates()
                } catch (e: Throwable) {
                    Log.e(TAG, "Error starting foreground service: ${e.message}", e)
                    stopSelf()
                }
                Log.i(TAG, "Location service started for session $sid")
            }
            ACTION_STOP -> {
                Log.i(TAG, "Location service stopping")
                stopLocationUpdates()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopLocationUpdates()
        serviceScope.cancel()
        super.onDestroy()
    }

    // â”€â”€ Location updates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private fun startLocationUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
            .setMinUpdateIntervalMillis(FASTEST_INTERVAL_MS)
            .setMinUpdateDistanceMeters(MIN_DISTANCE_M)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { location ->
                    lastLocation = location
                    postLocation(location, "interval")
                }
            }
        }

        try {
            fusedLocationClient.requestLocationUpdates(
                request,
                locationCallback!!,
                Looper.getMainLooper()
            )
        } catch (e: SecurityException) {
            Log.e(TAG, "Location permission missing: ${e.message}")
            stopSelf()
        }
    }

    private fun stopLocationUpdates() {
        locationCallback?.let {
            fusedLocationClient.removeLocationUpdates(it)
            locationCallback = null
        }
    }

    private fun postLocation(location: Location, updateType: String) {
        val sid = sessionId ?: return
        serviceScope.launch {
            try {
                RetrofitClient.apiService.postLocation(
                    LocationUpdateRequest(
                        sessionId  = sid,
                        latitude   = location.latitude,
                        longitude  = location.longitude,
                        accuracyM  = if (location.hasAccuracy()) location.accuracy else null,
                        speedMps   = if (location.hasSpeed()) location.speed else null,
                        headingDeg = if (location.hasBearing()) location.bearing else null,
                        capturedAt = nowIso(),
                        updateType = updateType
                    )
                )
            } catch (e: Exception) {
                Log.w(TAG, "Failed to post location: ${e.message}")
            }
        }
    }

    // â”€â”€ Notification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Location Tracking",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows while work session GPS tracking is active"
            setShowBadge(false)
        }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val tapIntent = Intent(this, WorkerActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("WorkSession: Tracking active")
            .setContentText("GPS location is being recorded")
            .setSmallIcon(R.drawable.ic_location_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    // â”€â”€ Companion (constants + static helpers) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    companion object {
        private const val TAG = "LocationService"

        const val ACTION_START = "com.worksession.tracker.ACTION_START_LOCATION"
        const val ACTION_STOP  = "com.worksession.tracker.ACTION_STOP_LOCATION"
        const val EXTRA_SESSION_ID = "session_id"

        private const val CHANNEL_ID       = "location_tracking"
        private const val NOTIFICATION_ID  = 1001
        private const val INTERVAL_MS      = 30_000L  // 30 seconds
        private const val FASTEST_INTERVAL_MS = 15_000L
        private const val MIN_DISTANCE_M   = 50f

        fun startIntent(context: Context, sessionId: String) =
            Intent(context, LocationService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_SESSION_ID, sessionId)
            }

        fun stopIntent(context: Context) =
            Intent(context, LocationService::class.java).apply {
                action = ACTION_STOP
            }
    }
}

