import { Request, Response } from "express";
import { config } from "../config";
import {
  ConsentRequiredError,
  SessionConflictError,
  endSession,
  getActiveSessionForWorker,
  startSession,
} from "../services/session.service";
import { getSessionRoute } from "../services/location.service";
import { recordAudit } from "../services/audit.service";
import { logActivity } from "../services/activity.service";
import { broadcastSessionEvent } from "../ws/socket";
import { pool } from "../db/pool";

export async function punchIn(req: Request, res: Response) {
  const workerId = req.user!.id;
  const clockMethod = req.body.clockMethod === "manual_no_location" ? "manual_no_location" : "gps";

  try {
    const session = await startSession({ workerId, clockMethod });

    await recordAudit({ actorId: workerId, action: "session.start", targetType: "work_session", targetId: session.id });

    broadcastSessionEvent({
      type: "session:started",
      workerId,
      teamId: req.user!.teamId,
      targetRole: req.user!.role === "manager" ? "manager" : "worker",
      sessionId: session.id,
    });

    // Activity log — punch-in
    logActivity({
      eventType:  "punch_in",
      userId:     workerId,
      userEmail:  req.user!.email,
      userRole:   req.user!.role,
      sessionId:  session.id,
      ipAddress:  req.ip,
      userAgent:  req.headers["user-agent"],
      metadata: {
        clockMethod,
        punchInTime: session.started_at,
        updateIntervalSec: session.update_interval_sec,
      },
    });

    res.status(201).json({
      session,
      trackingConfig: {
        updateIntervalSec: session.update_interval_sec,
        distanceFilterM:  session.distance_filter_m,
        enabled: clockMethod === "gps",
      },
    });
  } catch (err) {
    if (err instanceof ConsentRequiredError) {
      return res.status(412).json({ error: "consent_required", message: err.message });
    }
    if (err instanceof SessionConflictError) {
      return res.status(409).json({ error: "session_already_active", message: err.message });
    }
    throw err;
  }
}

export async function punchOut(req: Request, res: Response) {
  const workerId   = req.user!.id;
  const { sessionId } = req.params;

  // Fetch session data before ending it (for duration calculation)
  const sessionBefore = await pool.query(
    `SELECT started_at FROM work_sessions WHERE id = $1`,
    [sessionId]
  );

  const ended = await endSession({ sessionId, workerId, reason: "worker_punch_out" });
  if (!ended) {
    return res.status(404).json({ error: "No matching active session found for this worker" });
  }

  await recordAudit({ actorId: workerId, action: "session.end", targetType: "work_session", targetId: sessionId });

  broadcastSessionEvent({
    type: "session:ended",
    workerId,
    teamId: req.user!.teamId,
    targetRole: req.user!.role === "manager" ? "manager" : "worker",
    sessionId,
  });

  // Calculate shift duration
  const startedAt = sessionBefore.rows[0]?.started_at;
  const durationMs = startedAt ? Date.now() - new Date(startedAt).getTime() : null;
  const durationMin = durationMs ? Math.round(durationMs / 60000) : null;

  logActivity({
    eventType: "punch_out",
    userId:    workerId,
    userEmail: req.user!.email,
    userRole:  req.user!.role,
    sessionId,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: {
      punchOutTime: ended.ended_at,
      punchInTime:  startedAt,
      durationMinutes: durationMin,
    },
  });

  res.json({ session: ended });
}

export async function getMyActiveSession(req: Request, res: Response) {
  const session = await getActiveSessionForWorker(req.user!.id);
  res.json({ session });
}

export async function getRouteHistory(req: Request, res: Response) {
  const { sessionId } = req.params;

  const sessionResult = await pool.query(
    `SELECT ws.id, ws.worker_id, ws.status, ws.started_at, ws.ended_at, u.team_id
     FROM work_sessions ws JOIN users u ON u.id = ws.worker_id
     WHERE ws.id = $1`,
    [sessionId]
  );
  const session = sessionResult.rows[0];
  if (!session) return res.status(404).json({ error: "Session not found" });

  const isAdmin             = req.user!.role === "admin";
  const isAuthorizedManager = req.user!.role === "manager" && req.user!.teamId === session.team_id;
  if (!isAdmin && !isAuthorizedManager) {
    return res.status(403).json({ error: "Not authorized to view this worker's route history" });
  }

  const route = await getSessionRoute(sessionId);
  await recordAudit({ actorId: req.user!.id, action: "route.view", targetType: "work_session", targetId: sessionId });

  res.json({ session, route });
}
