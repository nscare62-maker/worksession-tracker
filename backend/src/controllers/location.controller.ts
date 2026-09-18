import { Request, Response } from "express";
import { recordLocationUpdate, SessionNotActiveError } from "../services/location.service";
import { logActivity } from "../services/activity.service";
import { broadcastLocationUpdate } from "../ws/socket";

export async function postLocationUpdate(req: Request, res: Response) {
  const workerId = req.user!.id;

  try {
    const row = await recordLocationUpdate({ ...req.body, workerId });

    broadcastLocationUpdate({
      workerId,
      teamId:     req.user!.teamId,
      targetRole: req.user!.role === "manager" ? "manager" : "worker",
      sessionId:  row.session_id,
      latitude:   row.latitude,
      longitude:  row.longitude,
      accuracyM:  row.accuracy_m,
      capturedAt: row.captured_at,
      isDelayed:  row.is_delayed,
    });

    // Log every real GPS fix to activity_log (fire-and-forget)
    logActivity({
      eventType:  "location_update",
      userId:     workerId,
      userEmail:  req.user!.email,
      userRole:   req.user!.role,
      sessionId:  row.session_id,
      latitude:   Number(row.latitude),
      longitude:  Number(row.longitude),
      accuracyM:  row.accuracy_m != null ? Number(row.accuracy_m) : null,
      metadata: {
        updateType: row.update_type,
        isDelayed:  row.is_delayed,
        capturedAt: row.captured_at,
      },
    });

    res.status(201).json({ locationUpdate: row });
  } catch (err: any) {
    if (err instanceof SessionNotActiveError) {
      return res.status(409).json({ error: "session_not_active", message: err.message });
    }
    if (err?.code === "LOW_ACCURACY") {
      return res.status(422).json({ error: "low_accuracy", message: err.message });
    }
    throw err;
  }
}

export async function postLocationBatch(req: Request, res: Response) {
  const workerId = req.user!.id;
  const items    = req.body.updates as Array<Record<string, unknown>>;

  const results = [];
  for (const item of items) {
    try {
      const row = await recordLocationUpdate({ ...(item as any), workerId, updateType: "queued_offline" });
      broadcastLocationUpdate({
        workerId,
        teamId:     req.user!.teamId,
        targetRole: req.user!.role === "manager" ? "manager" : "worker",
        sessionId:  row.session_id,
        latitude:   row.latitude,
        longitude:  row.longitude,
        accuracyM:  row.accuracy_m,
        capturedAt: row.captured_at,
        isDelayed:  true,
      });
      logActivity({
        eventType: "location_update",
        userId:    workerId,
        userEmail: req.user!.email,
        userRole:  req.user!.role,
        sessionId: row.session_id,
        latitude:  Number(row.latitude),
        longitude: Number(row.longitude),
        accuracyM: row.accuracy_m != null ? Number(row.accuracy_m) : null,
        metadata:  { updateType: "queued_offline", isDelayed: true },
      });
      results.push({ ok: true, id: row.id });
    } catch (err) {
      results.push({ ok: false, error: err instanceof Error ? err.message : "unknown_error" });
    }
  }

  res.status(207).json({ results });
}
