package com.worksession.tracker.utils

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.Toast
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// -- Activity helpers --

inline fun <reified T : Activity> Context.startActivity(clearStack: Boolean = false) {
    val intent = Intent(this, T::class.java)
    if (clearStack) {
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
    }
    startActivity(intent)
}

fun Context.toast(message: String, long: Boolean = false) {
    Toast.makeText(this, message, if (long) Toast.LENGTH_LONG else Toast.LENGTH_SHORT).show()
}

// -- View helpers --

var View.isVisible: Boolean
    get() = visibility == View.VISIBLE
    set(value) {
        visibility = if (value) View.VISIBLE else View.GONE
    }

// -- Date/time helpers --

private val isoFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'")
    .withZone(ZoneId.of("UTC"))

fun parseToInstant(isoString: String?): Instant? {
    if (isoString.isNullOrBlank()) return null
    return try {
        Instant.parse(isoString)
    } catch (_: Exception) {
        try {
            val normalized = isoString.trim().replace(' ', 'T')
            java.time.LocalDateTime.parse(normalized, DateTimeFormatter.ISO_DATE_TIME)
                .atZone(ZoneId.of("UTC"))
                .toInstant()
        } catch (_: Exception) {
            try {
                val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss[.SSS][.SS][.S]")
                    .withZone(ZoneId.of("UTC"))
                val ta = formatter.parse(isoString.trim())
                Instant.from(ta)
            } catch (_: Exception) {
                null
            }
        }
    }
}

fun parseSecondsAgo(isoString: String?): Long? {
    val instant = parseToInstant(isoString) ?: return null
    return try {
        maxOf(0L, Instant.now().epochSecond - instant.epochSecond)
    } catch (_: Exception) {
        null
    }
}

/** Format an ISO-8601 UTC timestamp for display in local time. */
fun String?.toDisplayTime(): String {
    if (this == null) return ""
    val instant = parseToInstant(this) ?: return this
    return try {
        DateTimeFormatter
            .ofPattern("HH:mm:ss")
            .withZone(ZoneId.systemDefault())
            .format(instant)
    } catch (_: Exception) {
        this
    }
}

/** Format an ISO-8601 timestamp as a relative "X min ago" string. */
fun String?.toRelativeTime(): String {
    if (this == null) return "Recent"
    val instant = parseToInstant(this) ?: return this
    return try {
        val diffSeconds = Instant.now().epochSecond - instant.epochSecond
        when {
            diffSeconds < 0       -> "just now"
            diffSeconds < 60      -> "${diffSeconds}s ago"
            diffSeconds < 3600    -> "${diffSeconds / 60}m ago"
            diffSeconds < 86400   -> "${diffSeconds / 3600}h ago"
            else                  -> "${diffSeconds / 86400}d ago"
        }
    } catch (_: Exception) {
        this
    }
}

/** Returns current time as ISO-8601 UTC string (e.g. "2024-01-15T10:30:00Z"). */
fun nowIso(): String = isoFormatter.format(Instant.now())

// -- Elapsed time formatting --

/**
 * Format elapsed seconds as HH:MM:SS.
 */
fun Long.toHhMmSs(): String {
    val hours   = this / 3600
    val minutes = (this % 3600) / 60
    val secs    = this % 60
    return "%02d:%02d:%02d".format(hours, minutes, secs)
}
