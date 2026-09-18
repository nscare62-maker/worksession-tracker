export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: "worker" | "manager" | "admin";
  teamId: string | null;
}

export interface ActiveSession {
  id: string;
  status: "active" | "ended" | "force_ended";
  clock_method: "gps" | "manual_no_location";
  started_at: string;
  update_interval_sec: number;
  distance_filter_m: number;
}

export type PermissionState = "granted" | "denied" | "restricted" | "unknown";

export interface QueuedLocationUpdate {
  sessionId: string;
  latitude: number;
  longitude: number;
  accuracyM?: number;
  speedMps?: number;
  headingDeg?: number;
  capturedAt: string;
}
