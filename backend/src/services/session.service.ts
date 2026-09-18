import { pool } from "../db/pool";
import { config } from "../config";

export class SessionConflictError extends Error {}
export class ConsentRequiredError extends Error {}

/** Starts a new work session for a worker. Requires a valid, current consent ack. */
export async function startSession(params: {
  workerId: string;
  clockMethod: "gps" | "manual_no_location";
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const consent = await client.query(
      `SELECT id FROM consent_acks
       WHERE user_id = $1 AND policy_version = $2
       ORDER BY acknowledged_at DESC LIMIT 1`,
      [params.workerId, config.consentPolicyVersion]
    );
    if (consent.rowCount === 0) {
      throw new ConsentRequiredError("Worker has not acknowledged the current tracking consent policy");
    }

    const existingActive = await client.query(
      `SELECT id FROM work_sessions WHERE worker_id = $1 AND status = 'active'`,
      [params.workerId]
    );
    if ((existingActive.rowCount ?? 0) > 0) {
      throw new SessionConflictError("Worker already has an active session");
    }

    const inserted = await client.query(
      `INSERT INTO work_sessions
         (worker_id, status, clock_method, update_interval_sec, distance_filter_m, consent_ack_id)
       VALUES ($1, 'active', $2, $3, $4, $5)
       RETURNING id, worker_id, status, clock_method, started_at, ended_at,
                 update_interval_sec, distance_filter_m`,
      [
        params.workerId,
        params.clockMethod,
        config.defaultUpdateIntervalSec,
        config.defaultDistanceFilterM,
        consent.rows[0].id,
      ]
    );

    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Ends a session. Idempotent-safe: ending an already-ended session is a no-op success. */
export async function endSession(params: {
  sessionId: string;
  workerId: string; // must match, unless forced by an admin
  reason: string;
  force?: boolean;
}) {
  const ownerClause = params.force ? "" : "AND worker_id = $2";
  const values = params.force ? [params.sessionId] : [params.sessionId, params.workerId];

  const result = await pool.query(
    `UPDATE work_sessions
     SET status = $${values.length + 1}, ended_at = now(), ended_reason = $${values.length + 2}
     WHERE id = $1 ${ownerClause} AND status = 'active'
     RETURNING id, worker_id, status, started_at, ended_at`,
    [...values, params.force ? "force_ended" : "ended", params.reason]
  );

  return result.rows[0] ?? null; // null means: not found, not owned, or already ended
}

export async function getActiveSessionForWorker(workerId: string) {
  const result = await pool.query(
    `SELECT id, status, clock_method, started_at, update_interval_sec, distance_filter_m
     FROM work_sessions WHERE worker_id = $1 AND status = 'active'`,
    [workerId]
  );
  return result.rows[0] ?? null;
}
