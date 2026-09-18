import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { WorkerPosition, RoutePoint } from "../types";
import { deriveStatus } from "../status";
import { StatusBadge } from "./StatusBadge";
import { api } from "../api";
import {
  MapPinIcon,
  ClockIcon,
  RouteIcon,
  NavigationIcon,
  UserIcon,
} from "./Icons";

type Session = { id: string; status: string; started_at: string; ended_at: string | null };

function formatCoords(lat: unknown, lng: unknown): string {
  if (lat == null || lng == null) return "No coordinates captured";
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (isNaN(numLat) || isNaN(numLng)) return "No coordinates captured";
  return `${numLat.toFixed(5)}, ${numLng.toFixed(5)}`;
}

function formatAccuracy(acc: unknown): string {
  if (acc == null) return "—";
  const numAcc = Number(acc);
  if (isNaN(numAcc)) return "—";
  return `±${Math.round(numAcc)} m`;
}

function formatDateTime(val: unknown, fallback = "—"): string {
  if (!val) return fallback;
  const d = new Date(val as string);
  return isNaN(d.getTime()) ? fallback : d.toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatTimeOnly(val: unknown, fallback = "No updates yet"): string {
  if (!val) return fallback;
  const d = new Date(val as string);
  return isNaN(d.getTime()) ? fallback : d.toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function WorkerDetail({
  workerId,
  position,
  worker,
  onLoadRoute,
}: {
  workerId: string;
  position?: WorkerPosition | undefined;
  worker?: {
    id: string;
    full_name: string;
    team_name?: string | null;
    role?: string;
    active_session_id?: string | null;
  } | null;
  onLoadRoute: (sessionId: string | null) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [lastRoutePoint, setLastRoutePoint] = useState<RoutePoint | null>(null);

  // Always resolve worker full name safely - NEVER "Unknown"!
  const fullName = worker?.full_name || position?.full_name || "Worker";
  const teamName = worker?.team_name || position?.team_name || "General Team";
  const roleName = worker?.role || position?.role || "Worker";

  useEffect(() => {
    onLoadRoute(null);
    setLoading(true);
    setLastRoutePoint(null);

    api.listWorkerSessions(workerId)
      .then((res) => {
        const sList: Session[] = res?.sessions ?? [];
        setSessions(sList);
        const active = sList.find((s) => s.status === "active");
        const activeId = active?.id ?? null;
        setActiveSessionId(activeId);

        // Auto-load route: prefer active shift, otherwise load most recent completed shift
        const targetSessionId = activeId ?? (sList.length > 0 ? sList[0].id : null);
        setSelectedSessionId(targetSessionId);
        if (targetSessionId) {
          onLoadRoute(targetSessionId);
          // Also fetch route to get last known coordinates if live position is missing
          api.getSessionRoute(targetSessionId).then((rRes) => {
            if (rRes?.route && rRes.route.length > 0) {
              setLastRoutePoint(rRes.route[rRes.route.length - 1]);
            }
          }).catch(() => {});
        } else {
          onLoadRoute(null);
        }
      })
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerId]);

  const isShiftActive = Boolean(worker?.active_session_id || position?.session_id);
  const status = position ? deriveStatus(position, !isShiftActive) : (isShiftActive ? "live" : "ended");

  // Determine effective coordinates: live position first, then latest route point fallback
  const effectiveLat = position?.latitude ?? lastRoutePoint?.latitude ?? null;
  const effectiveLng = position?.longitude ?? lastRoutePoint?.longitude ?? null;
  const effectiveTime = position?.captured_at ?? lastRoutePoint?.captured_at ?? null;
  const effectiveAccuracy = position?.accuracy_m ?? lastRoutePoint?.accuracy_m ?? null;

  function handleSelectSession(sId: string) {
    setSelectedSessionId(sId);
    onLoadRoute(sId);
    api.getSessionRoute(sId).then((rRes) => {
      if (rRes?.route && rRes.route.length > 0) {
        setLastRoutePoint(rRes.route[rRes.route.length - 1]);
      }
    }).catch(() => {});
  }

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "16px 16px 24px" }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={workerId}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24 }}
        >
          {/* Avatar + name (Always displays actual full name e.g. Gowri) */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
              background: "linear-gradient(135deg, #1d4ed8, #3b82f6)",
              border: "2px solid rgba(59,130,246,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 19, fontWeight: 800, color: "#fff",
              boxShadow: "0 0 16px rgba(59,130,246,0.3)",
            }}>
              {fullName.charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
                {fullName}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                <span>{teamName}</span>
                <span>•</span>
                <span style={{ textTransform: "capitalize" }}>{roleName}</span>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <StatusBadge status={status} />
          </div>

          {/* Location & Shift Stats */}
          <div style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
            marginBottom: 14,
          }}>
            {[
              {
                icon: <ClockIcon size={13} color="#94a3b8" />,
                label: "Shift Status",
                value: isShiftActive ? "Clocked In (Active)" : "Clocked Out (Shift Ended)",
                color: isShiftActive ? "#22c55e" : "#94a3b8",
              },
              {
                icon: <ClockIcon size={13} color="#94a3b8" />,
                label: "Last Recorded Time",
                value: formatTimeOnly(effectiveTime, isShiftActive ? "Waiting for GPS fix..." : "No recent time"),
                color: "var(--text-primary)",
              },
              {
                icon: <NavigationIcon size={13} color="#94a3b8" />,
                label: "GPS Accuracy",
                value: formatAccuracy(effectiveAccuracy),
                color: "var(--text-primary)",
              },
              {
                icon: <MapPinIcon size={13} color="#38bdf8" />,
                label: "Coordinates",
                value: formatCoords(effectiveLat, effectiveLng),
                color: effectiveLat ? "#38bdf8" : "var(--text-muted)",
              },
            ].map((row, i) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "9px 12px",
                  borderBottom: i < 3 ? "1px solid var(--border)" : "none",
                  gap: 10,
                  fontSize: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
                  {row.icon}
                  <span>{row.label}</span>
                </div>
                <span style={{ color: row.color, fontWeight: 600, textAlign: "right", wordBreak: "break-all" }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          {status === "stale" && (
            <div className="alert-strip warn" style={{ marginBottom: 14, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <ClockIcon size={13} color="#f59e0b" />
              <span>No real-time signal — displaying last recorded GPS coordinates.</span>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Shift history & Travelled path */}
      <div style={{ marginTop: 12 }}>
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>
          <RouteIcon size={13} color="#94a3b8" />
          <span>Shift History & Travelled Paths</span>
        </div>

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[1, 2, 3].map(n => <div key={n} className="skeleton" style={{ height: 56, borderRadius: 8 }} />)}
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: "16px 0" }}>
            No shift history recorded for this worker.
          </div>
        )}

        {sessions.map((s, i) => {
          const isActive = s.id === activeSessionId;
          const isSelected = s.id === selectedSessionId;
          return (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <button
                type="button"
                onClick={() => handleSelectSession(s.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  cursor: "pointer",
                  marginBottom: 8,
                  background: isSelected
                    ? "rgba(59,130,246,0.14)"
                    : isActive
                      ? "var(--green-dim)"
                      : "var(--bg-card)",
                  border: `1px solid ${
                    isSelected
                      ? "rgba(59,130,246,0.5)"
                      : isActive
                        ? "rgba(0,214,143,0.35)"
                        : "var(--border)"
                  }`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: "var(--text-primary)",
                  transition: "all 0.15s",
                  display: "block",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? "var(--green)" : "var(--text-primary)" }}>
                    {isActive ? "Live Session" : formatDateTime(s.started_at)}
                  </span>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: 99,
                    background: isActive ? "var(--green-dim)" : "rgba(255,255,255,0.05)",
                    color: isActive ? "var(--green)" : "var(--text-muted)",
                    border: `1px solid ${isActive ? "rgba(0,214,143,0.3)" : "var(--border)"}`,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}>
                    {s.status === "active" ? "Active" : "Ended"}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span>{new Date(s.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span>→</span>
                  <span>{s.ended_at ? new Date(s.ended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Ongoing"}</span>
                </div>
                <div style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: isSelected ? "var(--blue)" : isActive ? "var(--green)" : "var(--text-secondary)",
                  marginTop: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}>
                  <RouteIcon size={12} color="currentColor" />
                  <span>{isSelected ? "Displaying Travelled Path" : "View Travelled Path & Timing"}</span>
                </div>
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
