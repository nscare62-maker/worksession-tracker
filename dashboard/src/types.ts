export interface WorkerPosition {
  session_id: string;
  worker_id: string;
  full_name: string | null;
  role: "worker" | "manager";
  team_id: string | null;
  team_name: string | null;
  started_at: string;
  update_interval_sec: number;
  distance_filter_m: number;
  location_id: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  captured_at: string | null;
  received_at: string | null;
  is_delayed: boolean;
  permission_state: "granted" | "denied" | "restricted" | "unknown";
}

export type LiveStatus = "live" | "delayed" | "stale" | "offline" | "ended";

export interface RoutePoint {
  id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
  captured_at: string;
  is_delayed: boolean;
  update_type?: string;
}
