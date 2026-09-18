export type UserRole = "worker" | "manager" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  teamId: string | null;
}

export interface JwtPayload {
  sub: string;
  role: UserRole;
  teamId: string | null;
  email: string;
}

export type SessionStatus = "active" | "ended" | "force_ended";
export type UpdateType = "interval" | "distance" | "manual_ping" | "queued_offline";
export type PermissionState = "granted" | "denied" | "restricted" | "unknown";

export interface WorkSession {
  id: string;
  workerId: string;
  status: SessionStatus;
  clockMethod: "gps" | "manual_no_location";
  startedAt: string;
  endedAt: string | null;
  endedReason: string | null;
  updateIntervalSec: number;
  distanceFilterM: number;
}

export interface LocationUpdateInput {
  sessionId: string;
  latitude: number;
  longitude: number;
  accuracyM?: number;
  speedMps?: number;
  headingDeg?: number;
  capturedAt: string; // ISO timestamp from device
  updateType: UpdateType;
  permissionState?: PermissionState;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
