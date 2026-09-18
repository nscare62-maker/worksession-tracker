/**
 * activity.service.ts
 * Writes every notable event to the activity_log table in Supabase/Postgres.
 * All writes are fire-and-forget (never block the main request path).
 */
import { pool } from "../db/pool";

export type ActivityEventType =
  | "login"
  | "punch_in"
  | "punch_out"
  | "location_update"
  | "task_assigned"
  | "task_started"
  | "task_completed"
  | "consent_ack"
  | "user_created"
  | "user_deleted";

export interface ActivityEntry {
  eventType: ActivityEventType;
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  userRole?: string | null;
  sessionId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Fire-and-forget: never await this in the request handler. */
export function logActivity(entry: ActivityEntry): void {
  pool
    .query(
      `INSERT INTO activity_log
         (event_type, user_id, user_email, user_name, user_role,
          session_id, latitude, longitude, accuracy_m,
          ip_address, user_agent, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        entry.eventType,
        entry.userId      ?? null,
        entry.userEmail   ?? null,
        entry.userName    ?? null,
        entry.userRole    ?? null,
        entry.sessionId   ?? null,
        entry.latitude    ?? null,
        entry.longitude   ?? null,
        entry.accuracyM   ?? null,
        entry.ipAddress   ?? null,
        entry.userAgent   ?? null,
        entry.metadata    ? JSON.stringify(entry.metadata) : null,
      ]
    )
    .catch((err) => {
      // Non-fatal: activity log must never bring down the main API
      console.error("[activity_log] write failed:", err?.message);
    });
}

/** Fetch recent activity for the admin dashboard. */
export async function getRecentActivity(limit = 100) {
  const result = await pool.query(
    `SELECT id, event_type, user_email, user_name, user_role,
            session_id, latitude, longitude, accuracy_m,
            ip_address, metadata, created_at
     FROM activity_log
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}
