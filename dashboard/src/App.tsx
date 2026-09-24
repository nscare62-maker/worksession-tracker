
import React, { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, getAuthToken, setAuthToken } from "./api";
import { useLiveSocket } from "./socket";
import { MapView } from "./components/MapView";
import { WorkerList } from "./components/WorkerList";
import { WorkerDetail } from "./components/WorkerDetail";
import { ActivityLog } from "./components/ActivityLog";
import { CredentialsPanel } from "./components/CredentialsPanel";
import { RoutePoint, WorkerPosition } from "./types";
import {
  NavigationIcon,
  UsersIcon,
  ClipboardIcon,
  ActivityIcon,
  KeyIcon,
  LogOutIcon,
  ClockIcon,
  MapPinIcon,
  RouteIcon,
  UserIcon,
} from "./components/Icons";
import "./styles/motion.css";

const EASE = [0.4, 0, 0.2, 1] as [number, number, number, number];
const fadeUp   = { hidden: { opacity: 0, y: 28 }, visible: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.4, delay: i * 0.07, ease: EASE } }) };
const scaleIn  = { hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: EASE } } };

type PortalRole = "admin" | "manager" | "worker";
interface Task { id: string; title: string; description: string | null; assigned_by: string; assigned_to: string; status: "assigned" | "in_progress" | "completed"; assigner_name: string; assignee_name: string; completion_report: string | null; }
interface ActiveSession { id: string; status: string; started_at: string; update_interval_sec: number; distance_filter_m: number; clock_method: string; }

// ── CONSENT GATE ──
const CONSENT_TEXT = `WorkSession Tracker collects your GPS location while you are clocked in. Location data is shared with your manager and stored for up to 90 days. You can withdraw consent by not punching in. Data is never sold or shared with third parties.`;

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; }
  return String(Math.abs(h));
}

async function ensureConsent(): Promise<boolean> {
  try {
    const status = await api.getConsentStatus?.();
    if (status?.hasAcknowledgedCurrent) return true;
    await api.acknowledgeConsent?.(simpleHash(CONSENT_TEXT));
    return true;
  } catch { return true; }
}

// ── HELPERS ──
function Spinner() {
  return <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin-slow 0.7s linear infinite" }} />;
}

function StatChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: "rgba(7,13,26,0.8)", border: "1px solid var(--border-mid)", borderRadius: 8, padding: "5px 10px", minWidth: 80 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function TaskStatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    assigned:    { label: "Assigned",    color: "var(--blue)",  bg: "var(--blue-dim)"  },
    in_progress: { label: "In Progress", color: "var(--amber)", bg: "var(--amber-dim)" },
    completed:   { label: "Completed",   color: "var(--green)", bg: "var(--green-dim)" },
  };
  const s = map[status] ?? { label: status, color: "var(--text-muted)", bg: "rgba(255,255,255,0.06)" };
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99, color: s.color, background: s.bg, border: `1px solid ${s.color}44`, display: "inline-block" }}>
      {s.label}
    </span>
  );
}

function formatNow(): string {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatElapsed(startedAt: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h > 0 ? `${h}h ` : ""}${m}m ${s}s`;
}

const AVATAR_COLORS = ["blue","green","purple","cyan","amber"] as const;
function avatarColor(name: string): string {
  const n = name || "?";
  return AVATAR_COLORS[n.charCodeAt(0) % AVATAR_COLORS.length];
}
function initials(name: string): string {
  if (!name) return "?";
  return name.split(" ").map(n => n[0] ?? "").filter(Boolean).join("").toUpperCase().slice(0, 2) || "?";
}

// ── PUNCH IN PANEL (FOR MANAGERS & WORKERS) ──
const BEACON_INTERVAL_MS = 30_000;

function PunchInPanel({
  userFullName,
  userRole,
  onSessionChange,
  onLocationUpdate,
}: {
  userFullName: string;
  userRole: string;
  onSessionChange?: (session: ActiveSession | null) => void;
  onLocationUpdate?: (pos: { latitude: number; longitude: number; accuracy: number }) => void;
}) {
  const [session, setSession]     = useState<ActiveSession | null>(null);
  const [loading, setLoading]     = useState(true);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [message, setMessage]     = useState<string | null>(null);
  const [elapsed, setElapsed]     = useState<string>("");
  const [gpsStatus, setGpsStatus] = useState<"idle"|"locating"|"ok"|"error">("idle");
  const [accuracy, setAccuracy]   = useState<number | null>(null);
  const [gpsErrorMessage, setGpsErrorMessage] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState<boolean>(false);
  const [syncError, setSyncError]   = useState<string | null>(null);

  const beaconTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchIdRef     = useRef<number | null>(null);
  const lastPostRef    = useRef<number>(0);
  const sessionRef     = useRef<ActiveSession | null>(null);
  sessionRef.current   = session;

  const fetchSession = useCallback(async () => {
    try {
      const res = await api.getMyActiveSession?.();
      const s = res?.session ?? null;
      setSession(s);
      onSessionChange?.(s);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [onSessionChange]);

  useEffect(() => { fetchSession(); }, [fetchSession]);

  useEffect(() => {
    if (!session?.started_at) { setElapsed(""); return; }
    const tick = () => setElapsed(formatElapsed(session.started_at));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session?.started_at]);

  const sendBeacon = useCallback(async (sessionId: string) => {
    setGpsStatus((prev) => (prev === "ok" ? "ok" : "locating"));

    // 1. Native Android hardware bridge check (instant lock)
    if (typeof (window as any).AndroidBridge?.getLastKnownLocation === "function") {
      try {
        const raw = (window as any).AndroidBridge.getLastKnownLocation();
        const loc = JSON.parse(raw || "{}");
        if (loc.latitude && loc.longitude) {
          const acc = Math.round(loc.accuracy || 15);
          setAccuracy(acc);
          setGpsStatus("ok");
          setGpsErrorMessage(null);
          lastPostRef.current = Date.now();
          try {
            await api.postLocationUpdate?.({
              sessionId,
              latitude: loc.latitude,
              longitude: loc.longitude,
              accuracyM: acc,
              capturedAt: new Date(loc.time || Date.now()).toISOString(),
              updateType: "interval",
            });
            setLastSyncTime(new Date().toLocaleTimeString());
            setSyncFailed(false);
            setSyncError(null);
          } catch (e: any) {
            console.error("AndroidBridge postLocationUpdate error", e);
            setSyncFailed(true);
            setSyncError(e?.message || "Sync failed");
          }
        }
      } catch (e) {
        console.error("AndroidBridge query error", e);
      }
    }

    if (!navigator.geolocation) {
      setGpsStatus("error");
      setGpsErrorMessage("GPS geolocation is not supported on this browser/device.");
      return;
    }

    const postLocation = async (lat: number, lng: number, acc: number) => {
      try {
        setAccuracy(acc);
        setGpsStatus("ok");
        setGpsErrorMessage(null);
        lastPostRef.current = Date.now();
        onLocationUpdate?.({ latitude: lat, longitude: lng, accuracy: acc });
        await api.postLocationUpdate?.({
          sessionId,
          latitude: lat,
          longitude: lng,
          accuracyM: acc,
          capturedAt: new Date().toISOString(),
          updateType: "interval",
        });
        setLastSyncTime(new Date().toLocaleTimeString());
        setSyncFailed(false);
        setSyncError(null);
      } catch (err: any) {
        console.error("postLocation failed", err);
        setSyncFailed(true);
        setSyncError(err?.message || "Sync failed");
      }
    };

    // Try High Accuracy (satellite) first with 5s timeout
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        postLocation(pos.coords.latitude, pos.coords.longitude, Math.round(pos.coords.accuracy));
      },
      () => {
        // High accuracy timed out or failed (e.g. indoors) -> immediately fallback to network/WiFi location!
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            postLocation(pos.coords.latitude, pos.coords.longitude, Math.round(pos.coords.accuracy));
          },
          (err) => {
            setGpsStatus("error");
            if (err.code === 1) {
              setGpsErrorMessage("Location permission denied. Please allow Location in Phone Settings.");
            } else if (err.code === 2) {
              setGpsErrorMessage("Device Location/GPS is turned OFF. Please turn on Location in quick settings.");
            } else {
              setGpsErrorMessage("Acquiring GPS fix. Please ensure Location is enabled.");
            }
          },
          { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
        );
      },
      { enableHighAccuracy: true, timeout: 5_000, maximumAge: 5_000 }
    );
  }, [onLocationUpdate]);

  useEffect(() => {
    if (session?.id && session.status === "active") {
      const sId = session.id;
      sendBeacon(sId);

      // Continuous GPS tracking with watchPosition (network + satellite)
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        try {
          watchIdRef.current = navigator.geolocation.watchPosition(
            async (pos) => {
              const now = Date.now();
              const lat = pos.coords.latitude;
              const lng = pos.coords.longitude;
              const acc = Math.round(pos.coords.accuracy);
              setAccuracy(acc);
              setGpsStatus("ok");
              setGpsErrorMessage(null);
              onLocationUpdate?.({ latitude: lat, longitude: lng, accuracy: acc });

              // Post update at most once every 6 seconds to capture live movement smoothly
              if (now - lastPostRef.current >= 6000 && sessionRef.current?.id) {
                lastPostRef.current = now;
                try {
                  await api.postLocationUpdate?.({
                    sessionId: sessionRef.current.id,
                    latitude: lat,
                    longitude: lng,
                    accuracyM: acc,
                    capturedAt: new Date().toISOString(),
                    updateType: "interval",
                  });
                  setLastSyncTime(new Date().toLocaleTimeString());
                  setSyncFailed(false);
                  setSyncError(null);
                } catch (err: any) {
                  console.error("watchPosition postLocationUpdate failed", err);
                  setSyncFailed(true);
                  setSyncError(err?.message || "Sync failed");
                }
              }
            },
            () => {},
            { enableHighAccuracy: false, timeout: 20_000, maximumAge: 10_000 }
          );
        } catch { /* ignore */ }
      }

      // Heartbeat timer every 10 seconds for reliable background updates
      beaconTimerRef.current = setInterval(() => {
        if (sessionRef.current?.id) sendBeacon(sessionRef.current.id);
      }, 10_000);
    } else {
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (beaconTimerRef.current) clearInterval(beaconTimerRef.current);
      beaconTimerRef.current = null;
      setGpsStatus("idle");
      setAccuracy(null);
    }
    return () => {
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (beaconTimerRef.current) clearInterval(beaconTimerRef.current);
    };
  }, [session?.id, session?.status, sendBeacon]);

  async function handlePunchIn() {
    setBusy(true); setError(null); setMessage(null);
    try {
      await ensureConsent();
      const result: any = await api.punchIn?.("gps");
      const newSession = result?.session;
      setSession(newSession);
      onSessionChange?.(newSession);
      setMessage("✓ Shift started! GPS location beacon active.");
      if (newSession?.id) sendBeacon(newSession.id);
    } catch (e: any) {
      const msg = e?.message ?? "Punch-in failed";
      if (msg.includes("consent_required")) { setError("Consent required - retrying."); await ensureConsent(); handlePunchIn(); }
      else { setError(msg); }
    } finally { setBusy(false); }
  }

  async function handlePunchOut() {
    if (!session?.id) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await api.punchOut?.(session.id);
      setSession(null);
      onSessionChange?.(null);
      setMessage("✓ Shift ended.");
    } catch (e: any) { setError(e?.message ?? "Punch-out failed"); }
    finally { setBusy(false); }
  }

  if (loading) {
    return <div className="punch-panel" style={{ textAlign: "center", padding: 24 }}><Spinner /></div>;
  }

  const isActive = session?.status === "active";

  return (
    <div className={`punch-panel${isActive ? " active" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{userFullName}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {userRole === "admin" ? "Super Admin" : userRole === "manager" ? "Manager" : "Worker"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            display: "inline-block", width: 8, height: 8, borderRadius: "50%",
            background: isActive ? "var(--green)" : "var(--text-muted)",
            boxShadow: isActive ? "0 0 8px var(--green)" : "none",
          }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? "var(--green)" : "var(--text-muted)" }}>
            {isActive ? "ON SHIFT" : "OFF SHIFT"}
          </span>
        </div>
      </div>

      {isActive && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <StatChip label="Shift Duration" value={elapsed || "0m 00s"} color="var(--green)" />
          <StatChip
            label="GPS Beacon"
            value={
              gpsStatus === "ok"
                ? (accuracy ? `±${accuracy}m` : "Active")
                : gpsStatus === "locating"
                ? "Locating..."
                : "Error / Off"
            }
            color={
              gpsStatus === "ok"
                ? "var(--green)"
                : gpsStatus === "locating"
                ? "var(--amber)"
                : "#ef4444"
            }
          />
        </div>
      )}

      {isActive && gpsStatus === "error" && (
        <div style={{
          fontSize: 11,
          marginBottom: 10,
          padding: "8px 12px",
          borderRadius: 8,
          background: "rgba(239,68,68,0.12)",
          border: "1px solid rgba(239,68,68,0.35)",
          color: "#fca5a5",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span>⚠️ {gpsErrorMessage || "GPS signal not acquired. Please ensure Location is ON."}</span>
            <button
              type="button"
              onClick={() => session?.id && sendBeacon(session.id)}
              style={{
                background: "rgba(239,68,68,0.25)",
                border: "1px solid rgba(239,68,68,0.5)",
                borderRadius: 6,
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 8px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              🔄 Retry GPS
            </button>
          </div>
          {typeof (window as any).AndroidBridge?.openLocationSettings === "function" && (
            <button
              type="button"
              onClick={() => (window as any).AndroidBridge.openLocationSettings()}
              style={{
                background: "transparent",
                border: "none",
                color: "#38bdf8",
                fontSize: 11,
                fontWeight: 600,
                textAlign: "left",
                cursor: "pointer",
                padding: 0,
                textDecoration: "underline",
              }}
            >
              ⚙️ Open Android Location Settings
            </button>
          )}
        </div>
      )}

      {isActive && (
        <div style={{
          fontSize: 11,
          marginBottom: 12,
          padding: "6px 10px",
          borderRadius: 8,
          background: syncFailed ? "rgba(245,158,11,0.1)" : "rgba(34,197,94,0.1)",
          border: `1px solid ${syncFailed ? "rgba(245,158,11,0.3)" : "rgba(34,197,94,0.3)"}`,
          display: "flex",
          alignItems: "center",
          gap: 6
        }}>
          <span style={{ fontSize: 12 }}>{syncFailed ? "⚠️" : "📡"}</span>
          <span style={{ color: syncFailed ? "var(--amber)" : "var(--green)", fontWeight: 600 }}>
            {syncFailed
              ? (syncError ? `Server sync retrying (${syncError})...` : "Server sync retrying...")
              : (lastSyncTime ? `Live Broadcast Synced (${lastSyncTime})` : "Broadcasting live GPS to cloud server...")}
          </span>
        </div>
      )}

      <AnimatePresence>
        {error && <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="alert-strip error" style={{ marginBottom: 10 }}>⚠️ {error}</motion.div>}
        {message && <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="alert-strip success" style={{ marginBottom: 10 }}>{message}</motion.div>}
      </AnimatePresence>

      <div style={{ display: "flex", gap: 8 }}>
        {!isActive ? (
          <button type="button" className="btn-primary btn-green" onClick={handlePunchIn} disabled={busy} style={{ flex: 1, padding: "11px 20px", fontSize: 14 }}>
            {busy ? <Spinner /> : "⏱️ Punch In"}
          </button>
        ) : (
          <>
            <button type="button" className="btn-primary btn-red" onClick={handlePunchOut} disabled={busy} style={{ flex: 1, padding: "11px 16px", fontSize: 14 }}>
              {busy ? <Spinner /> : "⏹️ Punch Out"}
            </button>
            <button
              type="button"
              onClick={() => session?.id && sendBeacon(session.id)}
              disabled={busy}
              style={{
                padding: "11px 16px",
                fontSize: 13,
                fontWeight: 700,
                background: "rgba(59,130,246,0.15)",
                border: "1px solid rgba(59,130,246,0.4)",
                borderRadius: "var(--radius-sm, 8px)",
                color: "#38bdf8",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
              title="Force GPS update now"
            >
              🔄 Refresh GPS
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── LOGIN FORM ──
function LoginForm({ onLoggedIn }: { onLoggedIn: (role: PortalRole, fullName: string) => void }) {
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setLoading(true);
    try {
      const { token, user } = await api.login(email, password);
      setAuthToken(token);
      localStorage.setItem("worksession.role", user.role);
      localStorage.setItem("worksession.fullName", user.fullName);
      onLoggedIn(user.role, user.fullName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally { setLoading(false); }
  }

  return (
    <div className="bg-animated-gradient" style={{ position: "relative", display: "flex", minHeight: "100vh", width: "100%", alignItems: "center", justifyContent: "center", overflowY: "auto", padding: "20px 12px", boxSizing: "border-box" }}>
      <div className="grid-overlay" />
      <div className="scan-line" />

      {/* Floating orbs */}
      <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 70%)", top: "-10%", left: "-10%", animation: "float 8s ease-in-out infinite", pointerEvents: "none" }} />
      <div style={{ position: "absolute", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,214,143,0.08) 0%, transparent 70%)", bottom: "5%", right: "-5%", animation: "float 11s ease-in-out infinite reverse", pointerEvents: "none" }} />
      <div style={{ position: "absolute", width: 250, height: 250, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)", bottom: "30%", left: "10%", animation: "float 9s ease-in-out infinite", pointerEvents: "none" }} />

      <motion.div initial="hidden" animate="visible" variants={scaleIn} style={{ position: "relative", zIndex: 10, width: "min(440px, 94vw)", margin: "auto", overflowY: "visible" }}>
        <div className="glass-deep" style={{ padding: "30px 22px", borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
            <div style={{ position: "relative" }}>
              <div className="sidebar-logo-icon" style={{ width: 48, height: 48, fontSize: 22, borderRadius: 14 }}>📍</div>
              <div style={{ position: "absolute", inset: -5, borderRadius: "50%", border: "2px solid transparent", borderTopColor: "var(--blue)", borderRightColor: "var(--green)", animation: "spin-slow 4s linear infinite", pointerEvents: "none" }} />
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
                Work<span className="text-glow-blue">Session</span>
              </div>
              <div style={{ fontSize: 10, color: "var(--green)", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Live Location Tracking
              </div>
            </div>
          </div>

          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>Welcome back</h2>
          <p style={{ margin: "0 0 24px", fontSize: 13, color: "var(--text-secondary)" }}>Sign in to monitor your workforce in real time.</p>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Email Address</label>
              <input id="login-email" type="email" placeholder="your@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="input-field" required />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Password</label>
              <div style={{ position: "relative" }}>
                <input id="login-password" type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="input-field" style={{ paddingRight: 70 }} required />
                <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: "var(--blue)", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {error && <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="alert-strip error">⚠️ {error}</motion.div>}
            </AnimatePresence>

            <button type="submit" id="login-submit" className="btn-primary" style={{ width: "100%", padding: "14px 20px", fontSize: 15, marginTop: 4, background: "linear-gradient(135deg, #1d4ed8, #3b82f6)", boxShadow: "0 4px 24px rgba(59,130,246,0.4)" }} disabled={loading}>
              {loading ? <><Spinner /> &nbsp;Signing in...</> : "Sign In →"}
            </button>
          </form>

          {/* Footer */}
          <div style={{ marginTop: 24, padding: "14px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
            🔒 Your data is encrypted and your location is only tracked during active shifts.
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── ADMIN / MANAGER DASHBOARD ──
function Dashboard({ role, fullName }: { role: "admin" | "manager"; fullName: string }) {
  const [positions, setPositions]       = useState<WorkerPosition[]>([]);
  const [allWorkers, setAllWorkers]     = useState<{ id: string; full_name: string; team_name: string | null; active_session_id: string | null; role: string }[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [route, setRoute]               = useState<RoutePoint[] | null>(null);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [tasks, setTasks]               = useState<Task[]>([]);
  const [newTask, setNewTask]           = useState({ title: "", description: "", assignedTo: "" });
  const [taskMessage, setTaskMessage]   = useState<string | null>(null);
  const [teams, setTeams]               = useState<{ id: string; name: string }[]>([]);
  const [newUser, setNewUser]           = useState({ fullName: "", email: "", password: "", role: "worker" as "worker" | "manager", teamId: "" });
  const [userMessage, setUserMessage]   = useState<string | null>(null);
  const [createdAccount, setCreatedAccount] = useState<{ fullName: string; email: string; password: string; role: string; teamName?: string } | null>(null);
  const [copiedCreds, setCopiedCreds]   = useState(false);
  const [credsRefreshKey, setCredsRefreshKey] = useState(0);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [mySession, setMySession]       = useState<ActiveSession | null>(null);

  // Active navigation view: dashboard, workers, tasks, activity, credentials
  const [sideNav, setSideNav]           = useState<"dashboard"|"workers"|"tasks"|"activity"|"credentials">("dashboard");
  // Sub-tabs
  const [workerSubTab, setWorkerSubTab] = useState<"list"|"add">("list");
  // Right panel tab on dashboard (for admin, detail only; for manager, shift or detail)
  const [rightTab, setRightTab]         = useState<"detail"|"punchin">(role === "admin" ? "detail" : "punchin");
  // Map tab
  const [mapTab, setMapTab]             = useState<"live"|"route">("live");
  // Clock
  const [clock, setClock]               = useState(formatNow());

  useEffect(() => {
    const id = setInterval(() => setClock(formatNow()), 30_000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [{ positions: pos }, { workers }] = await Promise.all([api.getLivePositions(), api.listWorkers()]);
      setPositions(pos);
      setAllWorkers(workers);
      const tr = await api.getTasks();
      setTasks(tr.tasks);
      setLoadError(null);
    } catch (err) { setLoadError(err instanceof Error ? err.message : "Dashboard data could not be loaded."); }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    api.listTeams?.()
      .then((res: any) => {
        if (res?.teams && Array.isArray(res.teams)) {
          setTeams(res.teams);
          if (res.teams.length > 0 && !newUser.teamId) setNewUser(u => ({ ...u, teamId: res.teams[0].id }));
        }
      })
      .catch(() => {});
  }, []);

  const allWorkersRef = useRef(allWorkers);
  allWorkersRef.current = allWorkers;

  useLiveSocket((event) => {
    if (event.type === "location:update") {
      setPositions(prev => {
        const idx = prev.findIndex(p => p.worker_id === event.data.workerId);
        if (idx === -1) {
          // Immediately add worker to positions so map marker and live count update right away!
          const w = allWorkersRef.current.find(worker => worker.id === event.data.workerId);
          const newPos: WorkerPosition = {
            session_id: event.data.sessionId,
            worker_id: event.data.workerId,
            full_name: w?.full_name ?? "Worker",
            role: (w?.role ?? "worker") as "worker" | "manager",
            team_id: null,
            team_name: w?.team_name ?? null,
            started_at: event.data.capturedAt,
            update_interval_sec: 10,
            distance_filter_m: 10,
            location_id: `${event.data.sessionId}:${event.data.capturedAt}`,
            latitude: event.data.latitude,
            longitude: event.data.longitude,
            accuracy_m: event.data.accuracyM,
            captured_at: event.data.capturedAt,
            received_at: new Date().toISOString(),
            is_delayed: event.data.isDelayed,
            permission_state: "granted",
          };
          return [...prev, newPos];
        }
        const u = [...prev];
        u[idx] = {
          ...u[idx],
          latitude: event.data.latitude,
          longitude: event.data.longitude,
          accuracy_m: event.data.accuracyM,
          captured_at: event.data.capturedAt,
          is_delayed: event.data.isDelayed,
        };
        return u;
      });
      setRoute(prev => {
        const newPt: RoutePoint = {
          id: `${event.data.sessionId}:${event.data.capturedAt}`,
          latitude: event.data.latitude,
          longitude: event.data.longitude,
          accuracy_m: event.data.accuracyM,
          speed_mps: null,
          heading_deg: null,
          captured_at: event.data.capturedAt,
          is_delayed: event.data.isDelayed,
        };
        if (!prev || prev.length === 0) {
          return [newPt];
        }
        if (prev[prev.length - 1].captured_at === event.data.capturedAt) return prev;
        return [...prev, newPt];
      });
    }
    if (event.type === "session:started" || event.type === "session:ended") refresh();
  });

  async function handleLoadRoute(sessionId: string | null) {
    if (!sessionId) { setRoute(null); return; }
    try {
      const { route: r } = await api.getSessionRoute(sessionId);
      setRoute(r);
      setMapTab("route");
    } catch { setRoute(null); }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault(); setUserMessage(null); setCreatedAccount(null); setCopiedCreds(false); setIsCreatingUser(true);
    const targetRole = role === "manager" ? "worker" : newUser.role;
    const targetTeamId = role === "manager" ? undefined : (newUser.teamId ? newUser.teamId : undefined);
    try {
      await api.createUser({ fullName: newUser.fullName.trim(), email: newUser.email.trim(), password: newUser.password, role: targetRole, teamId: targetTeamId });
      const selectedTeam = teams.find(t => t.id === targetTeamId);
      setCreatedAccount({ fullName: newUser.fullName.trim(), email: newUser.email.trim(), password: newUser.password, role: targetRole, teamName: selectedTeam ? selectedTeam.name : (role === "manager" ? "Your Team" : "Unassigned") });
      setNewUser(u => ({ ...u, fullName: "", email: "", password: "", role: "worker" }));
      setUserMessage("✓ Account successfully created & credentials saved.");
      setCredsRefreshKey(k => k + 1);
      await refresh();
    } catch (err) { setUserMessage(err instanceof Error ? err.message : "Could not create account."); }
    finally { setIsCreatingUser(false); }
  }

  function generateRandomPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$";
    let pw = "";
    for (let i = 0; i < 10; i++) pw += chars.charAt(Math.floor(Math.random() * chars.length));
    setNewUser(u => ({ ...u, password: pw }));
  }

  function copyCreatedCredentials() {
    if (!createdAccount) return;
    const text = `Full Name: ${createdAccount.fullName}\nRole: ${createdAccount.role === "worker" ? "Employee" : createdAccount.role}\nEmail: ${createdAccount.email}\nPassword: ${createdAccount.password}\nTeam: ${createdAccount.teamName || "Unassigned"}`;
    navigator.clipboard.writeText(text).then(() => { setCopiedCreds(true); setTimeout(() => setCopiedCreds(false), 2000); });
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault(); setTaskMessage(null); setIsCreatingTask(true);
    try {
      await api.createTask(newTask);
      setNewTask({ title: "", description: "", assignedTo: "" });
      setTaskMessage("✓ Task assigned.");
      const tr = await api.getTasks();
      setTasks(tr.tasks);
    } catch (err) { setTaskMessage(err instanceof Error ? err.message : "Could not assign task."); }
    finally { setIsCreatingTask(false); }
  }

  function signOut() {
    setAuthToken(null);
    localStorage.removeItem("worksession.role");
    localStorage.removeItem("worksession.fullName");
    window.location.reload();
  }

  async function handleDeleteWorker(userId: string, name: string) {
    try {
      await api.deleteUser(userId);
      if (selectedWorkerId === userId) setSelectedWorkerId(null);
      await refresh();
    } catch { /* ignore */ }
  }

  const liveCount    = positions.length;
  const activeCount  = (allWorkers ?? []).filter(w => w.active_session_id).length;
  const offlineCount = (allWorkers ?? []).filter(w => !w.active_session_id).length;
  const totalCount   = (allWorkers ?? []).length;

  // Always resolve workerMeta and selectedPosition cleanly
  const workerMeta = selectedWorkerId ? allWorkers.find(w => w.id === selectedWorkerId) : undefined;
  const rawPos = selectedWorkerId ? positions.find(p => p.worker_id === selectedWorkerId) : undefined;
  const selectedPosition: WorkerPosition | undefined = rawPos
    ? {
        ...rawPos,
        full_name: (rawPos.full_name && rawPos.full_name !== "Unknown") ? rawPos.full_name : (workerMeta?.full_name || "Worker"),
        team_name: rawPos.team_name ?? workerMeta?.team_name ?? null,
      }
    : (workerMeta
        ? ({
            session_id: workerMeta.active_session_id ?? "",
            worker_id: selectedWorkerId!,
            full_name: workerMeta.full_name || "Worker",
            role: (workerMeta.role ?? "worker") as "worker" | "manager",
            team_id: null,
            team_name: workerMeta.team_name ?? null,
            started_at: workerMeta.active_session_id ? new Date().toISOString() : (null as any),
            update_interval_sec: 10,
            distance_filter_m: 10,
            location_id: null,
            latitude: null,
            longitude: null,
            accuracy_m: null,
            captured_at: null,
            received_at: null,
            is_delayed: false,
            permission_state: "unknown",
          } as WorkerPosition)
        : undefined);

  const pendingTasks   = (tasks ?? []).filter(t => t?.status !== "completed");
  const completedTasks = (tasks ?? []).filter(t => t?.status === "completed");

  // Deduplicated Sidebar items - exactly 1 of each!
  const sideItems: { key: typeof sideNav; icon: string; label: string; badge?: number }[] = [
    { key: "dashboard",   icon: "🗺️",  label: "Dashboard" },
    { key: "workers",     icon: "👥",  label: "Workers",     badge: totalCount || undefined },
    { key: "tasks",       icon: "📋",  label: "Tasks",       badge: pendingTasks.length || undefined },
    ...(role === "admin" ? [
      { key: "activity" as typeof sideNav,    icon: "📜", label: "Activity" },
      { key: "credentials" as typeof sideNav, icon: "🔑", label: "Credentials" },
    ] : []),
  ];

  return (
    <div className="app-shell">
      {/* ── SIDEBAR ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">📍</div>
          <div className="sidebar-logo-text">
            <div className="sidebar-logo-name">Work<span style={{ color: "var(--green)" }}>Session</span></div>
            <div className="sidebar-logo-sub">Live Tracking</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Navigation</div>
          {sideItems.map(item => (
            <button
              key={item.key}
              className={`sidebar-nav-item${sideNav === item.key ? " active" : ""}`}
              onClick={() => setSideNav(item.key)}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              {item.label}
              {item.badge ? <span className="sidebar-badge">{item.badge}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="sidebar-nav-item" onClick={signOut} style={{ width: "100%", color: "var(--red)", marginBottom: 8 }}>
            <span className="sidebar-nav-icon">🚪</span> Sign Out
          </button>
          <div className="sidebar-user">
            <div className={`sidebar-avatar ${avatarColor(fullName)}`}>{initials(fullName)}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{fullName}</div>
              <div className="sidebar-user-role">{role === "admin" ? "Super Admin" : "Manager"}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <div className="main-area">
        {/* Top Bar with Back & Sign Out buttons, NO search bar */}
        <header className="top-bar" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Back button */}
          <button
            type="button"
            onClick={() => {
              if (sideNav !== "dashboard") setSideNav("dashboard");
              else if (selectedWorkerId) setSelectedWorkerId(null);
              else window.history.back();
            }}
            title="Go Back"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              borderRadius: 8,
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid var(--border-mid)",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              flexShrink: 0
            }}
          >
            ← Back
          </button>

          <div className="top-bar-spacer" />

          {/* Live tracking badge */}
          <div className="live-badge" style={{ marginRight: 6 }}>
            <div className="live-badge-dot" />
            Live
          </div>

          <div className="top-bar-date">{clock}</div>

          <div className="top-bar-user" style={{ flexShrink: 0 }}>
            <div className={`top-bar-user-avatar ${avatarColor(fullName)}`}>{initials(fullName)}</div>
            <div>
              <div className="top-bar-user-name">{fullName}</div>
              <div className="top-bar-user-role">{role === "admin" ? "Super Admin" : "Manager"}</div>
            </div>
          </div>

          {/* Sign Out Button in top bar */}
          <button
            type="button"
            onClick={signOut}
            title="Sign out of account"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "7px 12px",
              borderRadius: 8,
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              color: "#f87171",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              flexShrink: 0
            }}
          >
            <LogOutIcon size={13} color="#f87171" style={{ marginRight: 5 }} /><span>Sign Out</span>
          </button>
        </header>

        {/* Content Area */}
        <div className="content-area" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          
          {/* ══════════════ 1. DASHBOARD PAGE ══════════════ */}
          {sideNav === "dashboard" && (
            <div className="dashboard-scroll-wrap" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
              {/* Stat Cards */}
              <div className="stat-cards-row">
                <motion.div className="stat-card blue" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                  <div className="stat-card-icon">👥</div>
                  <div className="stat-card-body">
                    <div className="stat-card-label">Total Workers</div>
                    <div className="stat-card-value">{totalCount}</div>
                    <div className="stat-card-trend neutral">All registered</div>
                  </div>
                </motion.div>
                <motion.div className="stat-card green" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                  <div className="stat-card-icon">⚡</div>
                  <div className="stat-card-body">
                    <div className="stat-card-label">Active / On Site</div>
                    <div className="stat-card-value">{activeCount + (mySession ? 1 : 0)}</div>
                    <div className="stat-card-trend up">On shift now</div>
                  </div>
                </motion.div>
                <motion.div className="stat-card amber" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                  <div className="stat-card-icon">📍</div>
                  <div className="stat-card-body">
                    <div className="stat-card-label">GPS Located</div>
                    <div className="stat-card-value">{liveCount}</div>
                    <div className="stat-card-trend up">Live positions</div>
                  </div>
                </motion.div>
                <motion.div className="stat-card red" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                  <div className="stat-card-icon">⏸️</div>
                  <div className="stat-card-body">
                    <div className="stat-card-label">Offline</div>
                    <div className="stat-card-value">{offlineCount}</div>
                    <div className="stat-card-trend neutral">Not clocked in</div>
                  </div>
                </motion.div>
              </div>

              {/* Map + Right Panel */}
              <div className="map-right-split">
                {/* Map Column */}
                <div className="map-container">
                  <div className="map-tab-bar">
                    <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)", marginRight: 12, letterSpacing: "-0.01em" }}>
                      <span style={{ color: "var(--green)" }}>Live Tracking</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, marginLeft: 8 }}>
                        Your Workforce, In Real Time
                      </span>
                    </div>
                    {(["live", "route"] as const).map(t => (
                      <button key={t} className={`map-tab-btn${mapTab === t ? " active" : ""}`}
                        onClick={() => setMapTab(t)}>
                        {t === "live" ? "Live" : (
                          <>
                            Route
                            {route && route.length > 0 && (
                              <span style={{
                                display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                                background: "#38bdf8", marginLeft: 5, verticalAlign: "middle",
                                boxShadow: "0 0 4px #38bdf8",
                              }} />
                            )}
                          </>
                        )}
                      </button>
                    ))}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {positions.length} tracked · {allWorkers.filter(w => !w.active_session_id).length} offline
                      </span>
                    </div>
                  </div>

                  {loadError && (
                    <div className="alert-strip error" style={{ position: "absolute", top: 56, left: "50%", transform: "translateX(-50%)", zIndex: 2000, maxWidth: 480 }}>⚠️ {loadError}</div>
                  )}

                  <div className="map-inner">
                    <MapView
                      positions={positions}
                      selectedWorkerId={selectedWorkerId}
                      route={route}
                      onWorkerClick={(id) => {
                        setSelectedWorkerId(id);
                        setRightTab("detail");
                        const worker = allWorkers.find(w => w.id === id);
                        if (worker?.active_session_id) {
                          handleLoadRoute(worker.active_session_id);
                        } else {
                          // Auto-load most recent session route even for offline workers
                          api.listWorkerSessions(id).then(res => {
                            const s = res?.sessions?.[0];
                            if (s?.id) handleLoadRoute(s.id);
                            else { setRoute(null); setMapTab("live"); }
                          }).catch(() => { setRoute(null); setMapTab("live"); });
                        }
                      }}
                    />
                  </div>

                  {!route && (
                    <div className="map-legend">
                    <div className="map-legend-item"><div className="map-legend-dot" style={{ background: "var(--green)" }} />On Site</div>
                    <div className="map-legend-item"><div className="map-legend-dot" style={{ background: "var(--amber)" }} />On Break</div>
                    <div className="map-legend-item"><div className="map-legend-dot" style={{ background: "#334155" }} />Offline</div>
                  </div>
                  )}
                </div>

                {/* Right Panel */}
                <div className="right-panel">
                  {/* Right panel tabs: NO punchin tab for Admin! */}
                  <div className="right-panel-tabs">
                    {role !== "admin" && (
                      <button
                        className={`right-panel-tab${rightTab === "punchin" ? " active" : ""}`}
                        onClick={() => setRightTab("punchin")}
                        style={{ display: "flex", alignItems: "center", gap: 5 }}
                      >
                        <ClockIcon size={13} color={rightTab === "punchin" ? "var(--blue)" : "var(--text-muted)"} />
                        <span>Shift</span>
                      </button>
                    )}
                    <button
                      className={`right-panel-tab${rightTab === "detail" ? " active" : ""}`}
                      onClick={() => setRightTab("detail")}
                      style={{ display: "flex", alignItems: "center", gap: 5 }}
                    >
                      <UserIcon size={13} color={rightTab === "detail" ? "var(--blue)" : "var(--text-muted)"} />
                      <span>Detail</span>
                    </button>
                  </div>

                  <div className="right-panel-body">
                    <AnimatePresence mode="wait">
                      {/* Only Manager sees punchin panel in dashboard; Admin has no punchin */}
                      {role !== "admin" && rightTab === "punchin" && (
                        <motion.div key="punchin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="right-panel-section">
                          <PunchInPanel userFullName={fullName} userRole={role} onSessionChange={s => { setMySession(s); if (s) refresh(); }} />
                          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7, marginTop: 8 }}>
                            When you punch in, your location is shared live on the map.
                          </div>
                        </motion.div>
                      )}

                      {rightTab === "detail" && (
                        <motion.div key="detail" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} style={{ flex: 1, minHeight: 0, height: "100%", overflow: "hidden" }}>
                          {selectedWorkerId ? (
                            <WorkerDetail workerId={selectedWorkerId} position={selectedPosition} worker={workerMeta} onLoadRoute={handleLoadRoute} />
                          ) : (
                            <div className="right-panel-section" style={{ textAlign: "center", paddingTop: 40 }}>
                              <div style={{ display: "inline-flex", padding: 14, borderRadius: "50%", background: "rgba(37,99,235,0.08)", marginBottom: 12 }}>
                                <UserIcon size={28} color="#334155" />
                              </div>
                              <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>
                                Select a worker from the map or live worker list to view their position and route history.
                              </div>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Worker List below */}
                  <div className="right-panel-worker-list-box" style={{ borderTop: "1px solid var(--border)", flexShrink: 0, maxHeight: 260, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <div className="right-panel-heading" style={{ padding: "10px 14px 6px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>Live Workers</span>
                      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        {activeCount} active · <button type="button" onClick={() => setSideNav("workers")} style={{ background: "transparent", border: "none", color: "var(--blue)", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: 0 }}>View All →</button>
                      </span>
                    </div>
                    <div className="right-panel-worker-list-scroll" style={{ flex: 1, overflowY: "auto" }}>
                      <WorkerList
                        positions={positions}
                        allWorkers={allWorkers}
                        selectedWorkerId={selectedWorkerId}
                        onSelect={(id) => {
                          setSelectedWorkerId(id);
                          setRightTab("detail");
                          const worker = allWorkers.find(w => w.id === id);
                          if (worker?.active_session_id) {
                            handleLoadRoute(worker.active_session_id);
                          } else {
                            api.listWorkerSessions(id).then(res => {
                              const s = res?.sessions?.[0];
                              if (s?.id) handleLoadRoute(s.id);
                              else { setRoute(null); setMapTab("live"); }
                            }).catch(() => { setRoute(null); setMapTab("live"); });
                          }
                        }}
                        onDelete={role === "admin" ? handleDeleteWorker : undefined}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom KPI Strip */}
              <div className="bottom-strip">
                <div className="bottom-kpi">
                  <div className="bottom-kpi-label">Total Workers</div>
                  <div className="bottom-kpi-value">{totalCount}</div>
                  <div className="bottom-kpi-trend neutral">Registered</div>
                </div>
                <div className="bottom-kpi">
                  <div className="bottom-kpi-label">Active Shifts</div>
                  <div className="bottom-kpi-value">{activeCount + (mySession ? 1 : 0)}</div>
                  <div className="bottom-kpi-trend up">On site now</div>
                </div>
                <div className="bottom-kpi">
                  <div className="bottom-kpi-label">Tasks Open</div>
                  <div className="bottom-kpi-value">{pendingTasks.length}</div>
                  <div className="bottom-kpi-trend neutral">Pending</div>
                </div>
                <div className="bottom-kpi">
                  <div className="bottom-kpi-label">GPS Tracked</div>
                  <div className="bottom-kpi-value">{liveCount}</div>
                  <div className="bottom-kpi-trend up">Live positions</div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════ 2. WORKERS PAGE ══════════════ */}
          {sideNav === "workers" && (
            <div className="page-full-view">
              <button
                type="button"
                onClick={() => setSideNav("dashboard")}
                style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", color: "var(--blue)", cursor: "pointer", fontSize: 12, fontWeight: 700, marginBottom: 12 }}
              >
                ← Back to Dashboard
              </button>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--text-primary)" }}>
                    👥 Workers Management
                  </h2>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    {totalCount} total workers · {activeCount} active on shift · {liveCount} GPS located
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className={`btn-sm ${workerSubTab === "list" ? "btn-primary" : "btn-outline"}`}
                    onClick={() => setWorkerSubTab("list")}
                    style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700 }}
                  >
                    All Workers ({totalCount})
                  </button>
                  <button
                    type="button"
                    className={`btn-sm ${workerSubTab === "add" ? "btn-primary" : "btn-outline"}`}
                    onClick={() => setWorkerSubTab("add")}
                    style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: workerSubTab === "add" ? "linear-gradient(135deg,#15803d,#00d68f)" : undefined }}
                  >
                    ➕ Add Worker
                  </button>
                </div>
              </div>

              {workerSubTab === "list" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {selectedWorkerId && (
                    <div style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-bright)", borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "rgba(59,130,246,0.08)" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--blue)" }}>Worker Detail Card</span>
                        <button type="button" onClick={() => setSelectedWorkerId(null)} style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✕ Close</button>
                      </div>
                      <WorkerDetail
                        workerId={selectedWorkerId}
                        position={selectedPosition}
                        worker={workerMeta}
                        onLoadRoute={(sId) => {
                          handleLoadRoute(sId);
                          setSideNav("dashboard");
                          setMapTab("route");
                        }}
                      />
                    </div>
                  )}

                  <div style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "12px", minHeight: 450 }}>
                    <WorkerList
                      positions={positions}
                      allWorkers={allWorkers}
                      selectedWorkerId={selectedWorkerId}
                      onSelect={(id) => {
                        setSelectedWorkerId(id);
                        const worker = allWorkers.find(w => w.id === id);
                        if (worker?.active_session_id) {
                          handleLoadRoute(worker.active_session_id);
                        } else {
                          api.listWorkerSessions(id).then(res => {
                            const s = res?.sessions?.[0];
                            if (s?.id) handleLoadRoute(s.id);
                            else setRoute(null);
                          }).catch(() => setRoute(null));
                        }
                      }}
                      onDelete={role === "admin" ? handleDeleteWorker : undefined}
                    />
                  </div>
                </div>
              )}

              {workerSubTab === "add" && (
                <div style={{ maxWidth: 540, width: "100%", margin: "0 auto", background: "var(--bg-card-solid)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "24px 20px" }}>
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>
                        {role === "admin" ? "Create Account" : "Add Team Employee"}
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, color: role === "admin" ? "var(--amber)" : "var(--blue)", background: role === "admin" ? "var(--amber-dim)" : "var(--blue-dim)", border: `1px solid ${role === "admin" ? "rgba(245,158,11,0.3)" : "rgba(59,130,246,0.3)"}`, textTransform: "uppercase" }}>
                        {role === "admin" ? "Admin" : "Manager"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                      {role === "admin" ? "Create Managers and Employees with custom team assignment." : "Create Employee accounts for your team."}
                    </div>
                  </div>

                  <form onSubmit={handleCreateUser} className="compact-form" style={{ gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Full Name</label>
                      <input aria-label="Full name" placeholder="e.g. John Doe" value={newUser.fullName} onChange={e => setNewUser({ ...newUser, fullName: e.target.value })} className="input-field" required />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Email Address</label>
                      <input aria-label="Email" type="email" placeholder="e.g. user@company.com" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} className="input-field" required />
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>Temporary Password</label>
                        <button type="button" onClick={generateRandomPassword} style={{ background: "transparent", border: "none", color: "var(--blue)", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: 0 }}>⚡ Generate</button>
                      </div>
                      <input aria-label="Password" placeholder="Minimum 6 characters" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className="input-field" minLength={6} required />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Role</label>
                      {role === "admin" ? (
                        <select aria-label="Role" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value as any })} className="input-field">
                          <option value="worker">👤 Employee</option>
                          <option value="manager">🛡️ Manager</option>
                        </select>
                      ) : (
                        <div style={{ padding: "8px 10px", borderRadius: 8, background: "var(--green-dim)", border: "1px solid rgba(0,214,143,0.3)", color: "var(--green)", fontSize: 12, fontWeight: 600 }}>
                          👤 Employee (fixed)
                        </div>
                      )}
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Team</label>
                      {role === "admin" ? (
                        <select aria-label="Team" value={newUser.teamId} onChange={e => setNewUser({ ...newUser, teamId: e.target.value })} className="input-field">
                          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          <option value="">(No team)</option>
                        </select>
                      ) : (
                        <div style={{ padding: "8px 10px", borderRadius: 8, background: "var(--blue-dim)", border: "1px solid rgba(59,130,246,0.3)", color: "var(--blue)", fontSize: 12, fontWeight: 600 }}>
                          👥 Auto-assigned to your team
                        </div>
                      )}
                    </div>
                    <button type="submit" className="btn-primary" disabled={isCreatingUser} style={{ marginTop: 8, padding: "12px 18px", fontSize: 14, background: newUser.role === "manager" && role === "admin" ? "linear-gradient(135deg,#0284c7,#38bdf8)" : "linear-gradient(135deg,#15803d,#00d68f)" }}>
                      {isCreatingUser ? <><Spinner /> &nbsp;Creating...</> : `➕ Create ${role === "admin" && newUser.role === "manager" ? "Manager" : "Employee"}`}
                    </button>
                    <AnimatePresence>{userMessage && <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`alert-strip ${userMessage.startsWith("✓") ? "success" : "error"}`}>{userMessage}</motion.div>}</AnimatePresence>
                  </form>

                  <AnimatePresence>
                    {createdAccount && (
                      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} style={{ marginTop: 16, background: "rgba(0,214,143,0.05)", border: "1px solid rgba(0,214,143,0.3)", borderRadius: 10, padding: "14px 16px" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>✓ Account Created Successfully</div>
                        <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 700 }}>{createdAccount.fullName}</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>Email: <code style={{ color: "var(--blue)" }}>{createdAccount.email}</code></div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>Password: <code style={{ color: "var(--green)", fontWeight: 700 }}>{createdAccount.password}</code></div>
                        <button type="button" onClick={copyCreatedCredentials} style={{ marginTop: 12, width: "100%", padding: "8px 12px", borderRadius: 8, cursor: "pointer", background: copiedCreds ? "var(--green-dim)" : "rgba(51,65,85,0.4)", border: `1px solid ${copiedCreds ? "rgba(0,214,143,0.5)" : "var(--border-mid)"}`, color: copiedCreds ? "var(--green)" : "var(--text-primary)", fontSize: 12, fontWeight: 700 }}>
                          {copiedCreds ? "✓ Copied to Clipboard!" : "📋 Copy Credentials"}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}

          {/* ══════════════ 3. TASKS PAGE ══════════════ */}
          {sideNav === "tasks" && (
            <div className="page-full-view">
              <button
                type="button"
                onClick={() => setSideNav("dashboard")}
                style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", color: "var(--blue)", cursor: "pointer", fontSize: 12, fontWeight: 700, marginBottom: 12 }}
              >
                ← Back to Dashboard
              </button>

              <div style={{ marginBottom: 16 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--text-primary)" }}>
                  📋 Task Management
                </h2>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  Assign work orders, track status, and inspect employee completion notes.
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, alignItems: "start" }}>
                <div style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 18px" }}>
                  <form onSubmit={handleCreateTask} className="compact-form" style={{ gap: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>Assign New Task</div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Task Title</label>
                      <input aria-label="Task title" placeholder="e.g. Inspect site A, Deliver safety gear" value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} className="input-field" required />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Instructions / Details</label>
                      <input aria-label="Instructions" placeholder="Specific notes, checklist, or location (optional)" value={newTask.description} onChange={e => setNewTask({ ...newTask, description: e.target.value })} className="input-field" />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Assign To</label>
                      <select aria-label="Assign to" value={newTask.assignedTo} onChange={e => setNewTask({ ...newTask, assignedTo: e.target.value })} className="input-field" required>
                        <option value="">Select a worker...</option>
                        {allWorkers.filter(w => role === "admin" || w.role === "worker").map(w => (
                          <option key={w.id} value={w.id}>{w.full_name} ({w.role === "worker" ? "employee" : w.role})</option>
                        ))}
                      </select>
                    </div>
                    <button type="submit" className="btn-primary" disabled={isCreatingTask} style={{ marginTop: 6, padding: "12px 18px", fontSize: 14 }}>
                      {isCreatingTask ? <><Spinner /> &nbsp;Assigning...</> : "Assign Task →"}
                    </button>
                    <AnimatePresence>
                      {taskMessage && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={`alert-strip ${taskMessage.startsWith("✓") ? "success" : "error"}`}>{taskMessage}</motion.div>}
                    </AnimatePresence>
                  </form>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "18px 16px" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
                      Active Tasks ({pendingTasks.length})
                    </div>
                    {pendingTasks.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "16px 0", textAlign: "center" }}>No pending tasks right now.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {pendingTasks.map(task => (
                          <div key={task.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-mid)", borderRadius: 10, padding: "12px 14px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{task.title}</span>
                              <TaskStatusPill status={task.status} />
                            </div>
                            {task.description && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>{task.description}</div>}
                            <div style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", gap: 12 }}>
                              <span>Assigned to: <strong style={{ color: "var(--text-primary)" }}>{task.assignee_name}</strong></span>
                              <span>By: {task.assigner_name}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {completedTasks.length > 0 && (
                    <div style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "18px 16px" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
                        Completed Tasks ({completedTasks.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {completedTasks.map(task => (
                          <div key={task.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-mid)", borderRadius: 10, padding: "12px 14px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{task.title}</span>
                              <TaskStatusPill status={task.status} />
                            </div>
                            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Completed by {task.assignee_name}</div>
                            {task.completion_report && (
                              <div style={{ fontSize: 11, color: "var(--green)", marginTop: 4, fontStyle: "italic", background: "rgba(0,214,143,0.06)", padding: "6px 8px", borderRadius: 6 }}>
                                "{task.completion_report}"
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════ 4. ACTIVITY LOG PAGE ══════════════ */}
          {sideNav === "activity" && role === "admin" && (
            <div className="page-full-view">
              <button
                type="button"
                onClick={() => setSideNav("dashboard")}
                style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", color: "var(--blue)", cursor: "pointer", fontSize: 12, fontWeight: 700, marginBottom: 12 }}
              >
                ← Back to Dashboard
              </button>

              <div style={{ marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--text-primary)" }}>
                  📜 Activity & Audit Log
                </h2>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  Real-time events, shift punch-ins, task completions, and GPS updates.
                </div>
              </div>
              <div style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px 14px", flex: 1, minHeight: 480, display: "flex", flexDirection: "column" }}>
                <ActivityLog />
              </div>
            </div>
          )}

          {/* ══════════════ 5. CREDENTIALS PAGE ══════════════ */}
          {sideNav === "credentials" && role === "admin" && (
            <div className="page-full-view">
              <button
                type="button"
                onClick={() => setSideNav("dashboard")}
                style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", color: "var(--blue)", cursor: "pointer", fontSize: 12, fontWeight: 700, marginBottom: 12 }}
              >
                ← Back to Dashboard
              </button>

              <div style={{ marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--text-primary)" }}>
                  🔑 Worker Credentials & Logins
                </h2>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  View employee access credentials, temporary passwords, and reset login tokens.
                </div>
              </div>
              <div style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px 14px", flex: 1, minHeight: 480, display: "flex", flexDirection: "column" }}>
                <CredentialsPanel refreshKey={credsRefreshKey} />
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── EMPLOYEE PORTAL ──
function EmployeePortal({ fullName }: { fullName: string }) {
  const [tasks, setTasks]                 = useState<Task[]>([]);
  const [report, setReport]               = useState<Record<string, string>>({});
  const [message, setMessage]             = useState<string | null>(null);
  const [tab, setTab]                     = useState<"shift" | "tasks">("shift");
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [myLocation, setMyLocation]       = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);

  useEffect(() => {
    api.getTasks().then(r => setTasks(Array.isArray(r?.tasks) ? r.tasks : [])).catch(e => setMessage(e?.message));
  }, []);

  async function updateTask(taskId: string, action: "start" | "complete") {
    try {
      if (action === "start") await api.startTask(taskId);
      else await api.completeTask(taskId, report[taskId] ?? "");
      setTasks((await api.getTasks()).tasks);
      setMessage(action === "start" ? "✓ Task started." : "✓ Report submitted.");
    } catch (e: any) { setMessage(e.message ?? "Failed."); }
  }

  function signOut() {
    setAuthToken(null);
    localStorage.removeItem("worksession.role");
    localStorage.removeItem("worksession.fullName");
    window.location.reload();
  }

  const pendingTasks = (tasks ?? []).filter(t => t?.status !== "completed");

  return (
    <div className="emp-shell">
      {/* Sidebar for desktop */}
      <div className="emp-sidebar">
        <div style={{ width: 36, height: 36, background: "linear-gradient(135deg, rgba(0,214,143,0.2), rgba(0,214,143,0.08))", border: "1px solid rgba(0,214,143,0.3)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, marginBottom: 16 }}>📍</div>
        <button className={`emp-sidebar-btn${tab === "shift" ? " active" : ""}`} onClick={() => setTab("shift")} title="My Shift">⏱️</button>
        <button className={`emp-sidebar-btn${tab === "tasks" ? " active" : ""}`} onClick={() => setTab("tasks")} title="My Tasks" style={{ position: "relative" }}>
          📋
          {pendingTasks.length > 0 && <span style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: "50%", background: "var(--amber)", border: "1.5px solid var(--bg-sidebar)" }} />}
        </button>
        <div style={{ flex: 1 }} />
        <button className="emp-sidebar-btn" onClick={signOut} title="Sign Out" style={{ color: "var(--red)" }}>🚪</button>
      </div>

      {/* Main */}
      <div className="emp-main">
        {/* Header with Back button & Sign Out */}
        <div className="emp-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Back button */}
            <button
              type="button"
              onClick={() => {
                if (tab !== "shift") setTab("shift");
                else window.history.back();
              }}
              title="Go Back"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "6px 10px",
                borderRadius: 8,
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid var(--border-mid)",
                color: "var(--text-primary)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700
              }}
            >
              ← Back
            </button>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                Hi, <span className="text-glow-green">{fullName}</span> 👋
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {tab === "shift" ? "Punch in to start shift & GPS tracking" : `${pendingTasks.length} task${pendingTasks.length !== 1 ? "s" : ""} pending`}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={signOut}
              title="Sign Out"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "6px 12px",
                borderRadius: 8,
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.35)",
                color: "#f87171",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700
              }}
            >
              <LogOutIcon size={13} color="#f87171" style={{ marginRight: 5 }} /><span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="emp-content">
          <AnimatePresence mode="wait">
            {tab === "shift" && (
              <motion.div key="shift" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <PunchInPanel
                  userFullName={fullName}
                  userRole="worker"
                  onSessionChange={setActiveSession}
                  onLocationUpdate={setMyLocation}
                />
                {/* Map */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
                  style={{ height: 340, borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)", marginTop: 4 }}>
                  <MapView
                    positions={myLocation && activeSession?.status === "active" ? [{
                      session_id: activeSession.id,
                      worker_id: "me",
                      full_name: fullName,
                      role: "worker",
                      team_id: null,
                      team_name: "My Shift",
                      started_at: activeSession.started_at,
                      update_interval_sec: 10,
                      distance_filter_m: 10,
                      location_id: "live-now",
                      latitude: myLocation.latitude,
                      longitude: myLocation.longitude,
                      accuracy_m: myLocation.accuracy,
                      captured_at: new Date().toISOString(),
                      received_at: new Date().toISOString(),
                      is_delayed: false,
                      permission_state: "granted",
                    }] : []}
                    selectedWorkerId={null}
                    route={null}
                  />
                </motion.div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, textAlign: "center" }}>
                  {activeSession?.status === "active" ? "Live tracking active • Synchronizing coordinates with server" : "Use the 📍 button on the map or punch in to begin tracking"}
                </div>
              </motion.div>
            )}

            {tab === "tasks" && (
              <motion.div key="tasks" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)", marginBottom: 14, letterSpacing: "-0.01em" }}>
                  My Tasks <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>({tasks.length} total)</span>
                </div>
                {tasks.length === 0 && !message && <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: 40, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border)" }}>No tasks assigned yet.</div>}
                {tasks.map((task, i) => (
                  <motion.div key={task.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="glass-card" style={{ padding: "16px 18px", marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>{task.title}</div>
                      <TaskStatusPill status={task.status} />
                    </div>
                    {task.description && <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>{task.description}</div>}
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>Assigned by {task.assigner_name}</div>
                    {task.status !== "completed" && (
                      <>
                        {task.status === "assigned" && <button type="button" className="btn-primary btn-sm" onClick={() => updateTask(task.id, "start")} style={{ marginBottom: 10, background: "linear-gradient(135deg,#0284c7,#3b82f6)" }}>▶ Start task</button>}
                        <textarea aria-label={`Report for ${task.title}`} placeholder="Completion report..." value={report[task.id] ?? ""} onChange={e => setReport({ ...report, [task.id]: e.target.value })} className="input-field" style={{ resize: "vertical", minHeight: 64, marginBottom: 8 }} />
                        <button type="button" className="btn-primary btn-sm btn-green" onClick={() => updateTask(task.id, "complete")}>✓ Submit report</button>
                      </>
                    )}
                  </motion.div>
                ))}
                <AnimatePresence>{message && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={`alert-strip ${message.startsWith("✓") ? "success" : "error"}`}>{message}</motion.div>}</AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ── ROOT ──
export default function App() {
  const storedRole     = localStorage.getItem("worksession.role");
  const storedFullName = localStorage.getItem("worksession.fullName") ?? "User";
  const [role, setRole]         = useState<PortalRole | null>(
    storedRole === "admin" || storedRole === "manager" || storedRole === "worker" ? storedRole : null
  );
  const [fullName, setFullName] = useState(storedFullName);

  function handleLoggedIn(r: PortalRole, name: string) { setRole(r); setFullName(name); }

  if (!getAuthToken() || !role) return <LoginForm onLoggedIn={handleLoggedIn} />;
  if (role === "worker")  return <EmployeePortal fullName={fullName} />;
  return <Dashboard role={role} fullName={fullName} />;
}