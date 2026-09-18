import { pool } from "../db/pool";
import { config } from "../config";
import { LocationUpdateInput } from "../types";

export class SessionNotActiveError extends Error {}

/**
 * Records a location update. Rejects if the session is not active.
 * Uses plain latitude/longitude columns (no PostGIS required for local dev).
 */
export async function recordLocationUpdate(input: LocationUpdateInput & { workerId: string }) {
  const session = await pool.query(
    `SELECT ws.id, ws.status, u.role AS worker_role
     FROM work_sessions ws JOIN users u ON u.id = ws.worker_id
     WHERE ws.id = $1 AND ws.worker_id = $2`,
    [input.sessionId, input.workerId]
  );
  if (session.rowCount === 0) {
    throw new SessionNotActiveError("Session not found for this worker");
  }
  if (session.rows[0].status !== "active") {
    throw new SessionNotActiveError("Session is not active; location updates are rejected");
  }

  const capturedAt = new Date(input.capturedAt);
  const now = new Date();
  const ageMs = now.getTime() - capturedAt.getTime();
  const isDelayed = input.updateType === "queued_offline" || ageMs > 90_000;

  // Reject positions whose accuracy is worse than threshold — those are
  // IP / cell-tower fallbacks, not real GPS fixes. Log and skip.
  const maxAccuracy = config.nodeEnv === "development" ? 3000 : 1000;
  if (input.accuracyM != null && input.accuracyM > maxAccuracy) {
    throw Object.assign(
      new Error(`Location rejected: accuracy ${Math.round(input.accuracyM)} m exceeds ${maxAccuracy} m threshold`),
      { code: "LOW_ACCURACY" }
    );
  }

  const result = await pool.query(
    `INSERT INTO location_updates
       (session_id, worker_id, latitude, longitude, accuracy_m, speed_mps, heading_deg,
        captured_at, update_type, is_delayed, permission_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, session_id, worker_id, latitude, longitude,
               accuracy_m, speed_mps, heading_deg, captured_at, received_at,
               update_type, is_delayed, permission_state`,
    [
      input.sessionId,
      input.workerId,
      input.latitude,
      input.longitude,
      input.accuracyM ?? null,
      input.speedMps ?? null,
      input.headingDeg ?? null,
      capturedAt.toISOString(),
      input.updateType,
      isDelayed,
      input.permissionState ?? "granted",
    ]
  );

  const row = result.rows[0];
  await pool.query(`UPDATE work_sessions SET last_location_id = $1 WHERE id = $2`, [row.id, input.sessionId]);
  return { ...row, worker_role: session.rows[0].worker_role };
}

/** Route history for a session. */
export async function getSessionRoute(sessionId: string) {
  const result = await pool.query(
    `SELECT id, latitude, longitude, accuracy_m, speed_mps, heading_deg,
            captured_at, is_delayed, update_type
     FROM location_updates
     WHERE session_id = $1
     ORDER BY captured_at ASC`,
    [sessionId]
  );
  return result.rows.map(r => ({
    ...r,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
    accuracy_m: r.accuracy_m != null ? Number(r.accuracy_m) : null,
    speed_mps: r.speed_mps != null ? Number(r.speed_mps) : null,
    heading_deg: r.heading_deg != null ? Number(r.heading_deg) : null,
  }));
}

/** Latest location per active session — managers + workers only, never admin. */
export async function getLiveWorkerPositions(teamIds: string[] | "all") {
  // admins are excluded from live tracking entirely — they monitor others
  const roleClause = teamIds === "all"
    ? "AND u.role IN ('manager', 'worker')"
    : "AND u.role = 'worker'";
  const teamClause = teamIds === "all" ? "" : "AND u.team_id = ANY($1)";
  const params = teamIds === "all" ? [] : [teamIds];

  const result = await pool.query(
    `SELECT DISTINCT ON (ws.worker_id)
            ws.id AS session_id, ws.worker_id, u.full_name, u.team_id, t.name AS team_name,
            ws.started_at, ws.update_interval_sec, ws.distance_filter_m,
            lu.id AS location_id, lu.latitude, lu.longitude,
            lu.accuracy_m, lu.captured_at, lu.received_at, lu.is_delayed, lu.permission_state
     FROM work_sessions ws
     JOIN users u ON u.id = ws.worker_id
     LEFT JOIN teams t ON t.id = u.team_id
     LEFT JOIN location_updates lu ON lu.id = ws.last_location_id
     WHERE ws.status = 'active' ${roleClause} ${teamClause}
     ORDER BY ws.worker_id, ws.started_at DESC`,
    params
  );
  return result.rows.map(r => ({
    ...r,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
    accuracy_m: r.accuracy_m != null ? Number(r.accuracy_m) : null,
  }));
}

/** Deletes location rows older than the retention window. */
export async function purgeExpiredLocations(retentionDays: number) {
  const result = await pool.query(
    `DELETE FROM location_updates WHERE captured_at < now() - ($1 || ' days')::interval`,
    [retentionDays]
  );
  return result.rowCount;
}
