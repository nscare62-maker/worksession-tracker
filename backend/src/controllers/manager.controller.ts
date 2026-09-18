import { Request, Response } from "express";
import { getLiveWorkerPositions } from "../services/location.service";
import { pool } from "../db/pool";
import bcrypt from "bcrypt";
import { logActivity } from "../services/activity.service";

export async function createManagedUser(req: Request, res: Response) {
  const actor        = req.user!;
  const requestedRole = req.body.role as "worker" | "manager";
  const fullName      = req.body.fullName as string;
  const email         = req.body.email as string;
  const password      = req.body.password as string;

  // Role enforcement
  if (actor.role === "manager" && requestedRole !== "worker") {
    return res.status(403).json({ error: "Managers can only create employee accounts" });
  }

  // Team assignment:
  //  - Manager → always their own team
  //  - Admin   → use provided teamId (optional)
  const rawTeamId = req.body.teamId as string | undefined | null;
  const teamId =
    actor.role === "manager"
      ? actor.teamId
      : (typeof rawTeamId === "string" && rawTeamId.trim() !== "" ? rawTeamId.trim() : null);

  if (!teamId && actor.role === "manager") {
    return res.status(400).json({ error: "Manager has no team assigned" });
  }

  // Duplicate email check
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role, team_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, full_name, role, team_id, created_at`,
    [email, passwordHash, fullName, requestedRole, teamId]
  );
  const newUser = result.rows[0];

  if (requestedRole === "manager" && teamId) {
    await pool.query(
      `INSERT INTO manager_team_access (manager_id, team_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [newUser.id, teamId]
    ).catch(() => {});
  }

  // ── Save plain credentials to user_credentials table ──────────────────
  await pool.query(
    `INSERT INTO user_credentials
       (user_id, email, plain_password, role, full_name, team_id,
        created_by, created_by_email, created_by_role)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      newUser.id,
      email,
      password,           // plain text — for admin visibility only
      requestedRole,
      fullName,
      teamId,
      actor.id,
      actor.email,
      actor.role,
    ]
  );

  // ── Activity log ───────────────────────────────────────────────────────
  logActivity({
    eventType: "user_created",
    userId:    actor.id,
    userEmail: actor.email,
    userRole:  actor.role,
    metadata: {
      newUserId:    newUser.id,
      newUserEmail: email,
      newUserName:  fullName,
      newUserRole:  requestedRole,
      teamId:       teamId ?? null,
      plainPassword: password,    // stored here too for the activity_log view
    },
  });

  res.status(201).json({ user: newUser });
}

export async function getLivePositions(req: Request, res: Response) {
  const teamScope =
    req.user!.role === "admin"
      ? "all"
      : ([req.user!.teamId].filter(Boolean) as string[]);
  const positions = await getLiveWorkerPositions(teamScope);
  res.json({ positions });
}

export async function listWorkers(req: Request, res: Response) {
  const isAdmin = req.user!.role === "admin";
  const { q, status } = req.query as { q?: string; status?: string };

  const conditions: string[] = [
    isAdmin ? "u.role IN ('manager','worker')" : "u.role = 'worker'",
  ];
  const params: unknown[] = [];

  if (!isAdmin) {
    params.push(req.user!.teamId);
    conditions.push(`u.team_id = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`u.full_name ILIKE $${params.length}`);
  }

  const result = await pool.query(
    `SELECT u.id, u.full_name, u.role, u.email, u.team_id, t.name AS team_name,
            ws.id AS active_session_id, ws.started_at AS session_started_at
     FROM users u
     LEFT JOIN teams t       ON t.id = u.team_id
     LEFT JOIN work_sessions ws ON ws.worker_id = u.id AND ws.status = 'active'
     WHERE ${conditions.join(" AND ")}
     ORDER BY u.role, u.full_name`,
    params
  );

  let rows = result.rows;
  if (status === "active")   rows = rows.filter((r) => r.active_session_id);
  if (status === "inactive") rows = rows.filter((r) => !r.active_session_id);

  res.json({ workers: rows });
}

export async function listWorkerSessions(req: Request, res: Response) {
  const { workerId } = req.params;
  const workerResult = await pool.query(
    `SELECT id, team_id FROM users WHERE id = $1`,
    [workerId]
  );
  const worker = workerResult.rows[0];
  if (!worker) return res.status(404).json({ error: "Worker not found" });

  const isAdmin             = req.user!.role === "admin";
  const isAuthorizedManager = req.user!.role === "manager" && req.user!.teamId === worker.team_id;
  if (!isAdmin && !isAuthorizedManager) {
    return res.status(403).json({ error: "Not authorized for this worker's team" });
  }

  const sessions = await pool.query(
    `SELECT id, status, started_at, ended_at, ended_reason
     FROM work_sessions WHERE worker_id = $1
     ORDER BY started_at DESC LIMIT 50`,
    [workerId]
  );
  res.json({ sessions: sessions.rows });
}

/** Returns all user_credentials rows — admin only */
export async function listCredentials(req: Request, res: Response) {
  const result = await pool.query(
    `SELECT uc.id, uc.user_id, uc.email, uc.plain_password, uc.role, uc.full_name,
            t.name AS team_name, uc.created_by_email, uc.created_by_role, uc.created_at
     FROM user_credentials uc
     LEFT JOIN teams t ON t.id = uc.team_id
     ORDER BY uc.created_at DESC`
  );
  res.json({ credentials: result.rows });
}

/** Delete a user account — admin only. Removes from local DB + Supabase. */
export async function deleteUser(req: Request, res: Response) {
  const actor = req.user!;
  if (actor.role !== "admin") {
    return res.status(403).json({ error: "Only admins can delete accounts" });
  }

  const { userId } = req.params;

  // Fetch user info before deleting (for audit log)
  const userRes = await pool.query(
    `SELECT id, email, full_name, role FROM users WHERE id = $1`,
    [userId]
  );
  const target = userRes.rows[0];
  if (!target) return res.status(404).json({ error: "User not found" });

  // Prevent admin from deleting themselves
  if (userId === actor.id) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }

  // Delete in correct order (FK constraints)
  // 1. End any active work sessions
  await pool.query(
    `UPDATE work_sessions SET status='ended', ended_at=NOW(), ended_reason='account_deleted' WHERE worker_id=$1 AND status='active'`,
    [userId]
  );
  // 2. Delete location updates for sessions of this user
  await pool.query(
    `DELETE FROM location_updates WHERE session_id IN (SELECT id FROM work_sessions WHERE worker_id=$1)`,
    [userId]
  ).catch(() => {});
  // 3. Delete consent records
  await pool.query(`DELETE FROM location_consent WHERE user_id=$1`, [userId]).catch(() => {});
  // 4. Delete tasks assigned by or to this user
  await pool.query(`DELETE FROM tasks WHERE assigned_to=$1 OR assigned_by=$1`, [userId]).catch(() => {});
  // 5. Delete manager team access
  await pool.query(`DELETE FROM manager_team_access WHERE manager_id=$1`, [userId]).catch(() => {});
  // 6. Delete work sessions
  await pool.query(`DELETE FROM work_sessions WHERE worker_id=$1`, [userId]).catch(() => {});
  // 7. Delete credentials record
  await pool.query(`DELETE FROM user_credentials WHERE user_id=$1`, [userId]).catch(() => {});
  // 8. Delete the user
  await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);

  // Activity log
  logActivity({
    eventType: "user_deleted",
    userId:    actor.id,
    userEmail: actor.email,
    userRole:  actor.role,
    metadata: {
      deletedUserId:    userId,
      deletedUserEmail: target.email,
      deletedUserName:  target.full_name,
      deletedUserRole:  target.role,
    },
  });

  res.json({ success: true, deletedUser: { id: userId, email: target.email, fullName: target.full_name } });
}
