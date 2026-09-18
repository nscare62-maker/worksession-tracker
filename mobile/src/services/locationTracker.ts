import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import * as Network from "expo-network";
import { api } from "./api";
import { enqueue, flushQueue } from "./offlineQueue";

export const LOCATION_TASK_NAME = "worksession-location-task";
const NOTIFICATION_ID = "worksession-tracking-active";

let activeSessionId: string | null = null;
let lastSentAt: number | null = null;
let lastAccuracy: number | null = null;
let lastPermissionState: Location.PermissionStatus | null = null;

export function getTrackingSnapshot() {
  return { activeSessionId, lastSentAt, lastAccuracy, lastPermissionState };
}

/** Request permissions up front so we can show the worker their exact permission state
 *  (never silently proceed as if location were available when it is not). */
export async function requestLocationPermissions(): Promise<{
  foreground: Location.PermissionStatus;
  background: Location.PermissionStatus;
}> {
  const fg = await Location.requestForegroundPermissionsAsync();
  let bg: Location.PermissionResponse = { status: Location.PermissionStatus.DENIED } as any;
  if (fg.status === Location.PermissionStatus.GRANTED) {
    bg = await Location.requestBackgroundPermissionsAsync();
  }
  lastPermissionState = fg.status;
  return { foreground: fg.status, background: bg.status };
}

/** Starts tracking for a punched-in session. Must only ever be called with an active session. */
export async function startTracking(params: {
  sessionId: string;
  updateIntervalSec: number;
  distanceFilterM: number;
}) {
  activeSessionId = params.sessionId;

  await Notifications.setNotificationChannelAsync?.("tracking", {
    name: "Work session tracking",
    importance: Notifications.AndroidImportance.LOW,
  });
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: {
      title: "Tracking active",
      body: "Your location is being shared with your manager while you're clocked in.",
      sticky: true,
    },
    trigger: null,
  });

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: params.updateIntervalSec * 1000,
    distanceInterval: params.distanceFilterM,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "WorkSession Tracker",
      notificationBody: "Tracking active — you are clocked in.",
    },
  });

  // Capture one fresh point immediately so the map does not wait for the first interval.
  try {
    const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
    const update = {
      sessionId: params.sessionId,
      latitude: point.coords.latitude,
      longitude: point.coords.longitude,
      accuracyM: point.coords.accuracy ?? undefined,
      speedMps: point.coords.speed ?? undefined,
      headingDeg: point.coords.heading ?? undefined,
      capturedAt: new Date(point.timestamp).toISOString(),
      updateType: "manual_ping" as const,
    };
    await api.postLocationUpdate(update);
    lastSentAt = Date.now();
    lastAccuracy = point.coords.accuracy ?? null;
  } catch {
    // The background task will retry the first point on its normal schedule.
  }
}

/** Stops tracking immediately. Called on punch-out and MUST leave no residual location task running. */
export async function stopTracking() {
  activeSessionId = null;
  const isRunning = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
  await Notifications.dismissNotificationAsync(NOTIFICATION_ID).catch(() => {});
}

/** Background task handler — fires on the interval/distance triggers configured above. */
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !activeSessionId) return; // never send updates when clocked out
  const { locations } = (data as { locations: Location.LocationObject[] }) ?? { locations: [] };
  const point = locations?.[locations.length - 1];
  if (!point) return;

  lastAccuracy = point.coords.accuracy ?? null;

  const update = {
    sessionId: activeSessionId,
    latitude: point.coords.latitude,
    longitude: point.coords.longitude,
    accuracyM: point.coords.accuracy ?? undefined,
    speedMps: point.coords.speed ?? undefined,
    headingDeg: point.coords.heading ?? undefined,
    capturedAt: new Date(point.timestamp).toISOString(),
  };

  const net = await Network.getNetworkStateAsync();
  if (!net.isConnected || !net.isInternetReachable) {
    await enqueue(update);
    return;
  }

  try {
    await api.postLocationUpdate({ ...update, updateType: "interval" });
    lastSentAt = Date.now();
    // Opportunistically flush anything queued from an earlier outage.
    await flushQueue();
  } catch {
    // Server unreachable even though network reports "connected" — queue it, don't fabricate success.
    await enqueue(update);
  }
});
