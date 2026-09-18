import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, AppState } from "react-native";
import * as Network from "expo-network";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import {
  getTrackingSnapshot,
  requestLocationPermissions,
  startTracking,
  stopTracking,
} from "../services/locationTracker";
import { queueLength, flushQueue } from "../services/offlineQueue";
import { ActiveSession } from "../types";

type PermissionSummary = "granted" | "denied" | "unknown";

export function HomeScreen() {
  const { user, logout } = useAuth();
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [permission, setPermission] = useState<PermissionSummary>("unknown");
  const [isOnline, setIsOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const net = await Network.getNetworkStateAsync();
    setIsOnline(Boolean(net.isConnected && net.isInternetReachable));
    setQueued(await queueLength());
    try {
      const { session: active } = await api.getMyActiveSession();
      setSession(active);
    } catch {
      // non-fatal; keep last known state
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshStatus();
    });
    const interval = setInterval(refreshStatus, 15_000);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [refreshStatus]);

  async function handlePunchIn(clockMethod: "gps" | "manual_no_location") {
    setBusy(true);
    setError(null);
    try {
      if (clockMethod === "gps") {
        const perms = await requestLocationPermissions();
        if (perms.foreground !== "granted") {
          setPermission("denied");
          setError("Location permission denied. Use \"Punch in without location\" instead, or enable location in Settings.");
          setBusy(false);
          return;
        }
        setPermission("granted");
      }

      const { session: newSession } = await api.punchIn(clockMethod);
      setSession(newSession);

      if (clockMethod === "gps") {
        await startTracking({
          sessionId: newSession.id,
          updateIntervalSec: newSession.update_interval_sec,
          distanceFilterM: newSession.distance_filter_m,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not punch in");
    } finally {
      setBusy(false);
    }
  }

  async function handlePunchOut() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await stopTracking(); // stop location FIRST, unconditionally
      await api.punchOut(session.id);
      setSession(null);
      await flushQueue(); // send any last queued points now that the shift is ending
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not punch out");
    } finally {
      setBusy(false);
    }
  }

  const tracking = getTrackingSnapshot();
  const isActive = session?.status === "active";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hi, {user?.fullName}</Text>
        <Pressable onPress={logout}>
          <Text style={styles.logout}>Sign out</Text>
        </Pressable>
      </View>

      {isActive ? (
        <View style={styles.trackingCard}>
          <Text style={styles.trackingActive}>● Tracking active</Text>
          <Text style={styles.trackingSub}>Shift started {new Date(session!.started_at).toLocaleTimeString()}</Text>
          <View style={styles.statRow}>
            <Stat label="GPS accuracy" value={tracking.lastAccuracy ? `${Math.round(tracking.lastAccuracy)} m` : "—"} />
            <Stat
              label="Last update"
              value={tracking.lastSentAt ? new Date(tracking.lastSentAt).toLocaleTimeString() : "Pending..."}
            />
          </View>
          <View style={styles.statRow}>
            <Stat label="Connection" value={isOnline ? "Online" : "Offline"} warn={!isOnline} />
            <Stat label="Queued updates" value={String(queued)} warn={queued > 0} />
          </View>
          <Pressable style={[styles.button, styles.punchOut]} onPress={handlePunchOut} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? "Punching out..." : "Punch Out"}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.trackingCard}>
          <Text style={styles.notTracking}>Not clocked in</Text>
          <Text style={styles.trackingSub}>
            Punching in starts live location sharing with your manager until you punch out.
          </Text>
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={[styles.button, styles.punchIn]} onPress={() => handlePunchIn("gps")} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? "Working..." : "Punch In"}</Text>
          </Pressable>
          <Pressable style={styles.altButton} onPress={() => handlePunchIn("manual_no_location")} disabled={busy}>
            <Text style={styles.altButtonText}>Punch in without location (permission unavailable)</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, warn && styles.statWarn]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", padding: 20, paddingTop: 60 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  greeting: { color: "#fff", fontSize: 20, fontWeight: "600" },
  logout: { color: "#94a3b8" },
  trackingCard: { backgroundColor: "#1e293b", borderRadius: 16, padding: 20 },
  trackingActive: { color: "#22c55e", fontSize: 18, fontWeight: "700", marginBottom: 4 },
  notTracking: { color: "#e2e8f0", fontSize: 18, fontWeight: "700", marginBottom: 4 },
  trackingSub: { color: "#94a3b8", marginBottom: 16 },
  statRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  stat: { flex: 1 },
  statLabel: { color: "#64748b", fontSize: 12 },
  statValue: { color: "#e2e8f0", fontSize: 16, fontWeight: "600" },
  statWarn: { color: "#f59e0b" },
  button: { padding: 16, borderRadius: 10, alignItems: "center", marginTop: 8 },
  punchIn: { backgroundColor: "#16a34a" },
  punchOut: { backgroundColor: "#dc2626" },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  altButton: { marginTop: 12, alignItems: "center" },
  altButtonText: { color: "#94a3b8", textDecorationLine: "underline", fontSize: 13 },
  error: { color: "#f87171", marginBottom: 12 },
});
