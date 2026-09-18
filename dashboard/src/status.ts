import { LiveStatus, WorkerPosition } from "./types";

const STALE_THRESHOLD_SEC = Number(import.meta.env.VITE_STALE_THRESHOLD_SEC ?? 180);

/**
 * Single source of truth for how the dashboard labels a worker's current status.
 * Mirrors backend/src/__tests__/status.test.ts — keep both in sync if you change
 * the rules. Never infers a location: a missing point is "stale", not extrapolated.
 */
export function deriveStatus(pos: WorkerPosition, sessionEnded: boolean): LiveStatus {
  if (sessionEnded) return "ended";
  if (pos.permission_state === "denied" || pos.permission_state === "restricted") return "offline";
  if (!pos.captured_at) return "stale";

  const capturedTime = new Date(pos.captured_at).getTime();
  if (isNaN(capturedTime)) return "stale";
  const ageSec = (Date.now() - capturedTime) / 1000;
  if (ageSec > STALE_THRESHOLD_SEC) return "stale";
  if (pos.is_delayed) return "delayed";
  const intervalSec = Number(pos.update_interval_sec) || 60;
  if (ageSec <= intervalSec * 2) return "live";
  return "stale";
}

export const STATUS_COLORS: Record<LiveStatus, string> = {
  live: "#16a34a",
  delayed: "#f59e0b",
  stale: "#eab308",
  offline: "#6b7280",
  ended: "#3b82f6",
};

export const STATUS_LABELS: Record<LiveStatus, string> = {
  live: "Live",
  delayed: "Delayed update",
  stale: "Stale — no recent update",
  offline: "Offline",
  ended: "Shift ended",
};
