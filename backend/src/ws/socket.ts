import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { JwtPayload } from "../types";
import { logger } from "../utils/logger";

interface ManagerSocket {
  ws: WebSocket;
  userId: string;
  role: string;
  teamId: string | null;
}

const managerSockets = new Set<ManagerSocket>();

export function initWebSocketServer(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");
    if (!token) { ws.close(4001, "Missing auth token"); return; }

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    } catch {
      ws.close(4001, "Invalid token");
      return;
    }

    if (payload.role !== "manager" && payload.role !== "admin") {
      ws.close(4003, "Only managers/admins may subscribe to live locations");
      return;
    }

    const entry: ManagerSocket = {
      ws,
      userId: payload.sub,
      role: payload.role,
      teamId: payload.teamId,
    };
    managerSockets.add(entry);
    logger.info({ userId: payload.sub }, "Manager WS connected");

    ws.on("close", () => managerSockets.delete(entry));
    ws.on("error", () => managerSockets.delete(entry));
  });

  return wss;
}

/**
 * Broadcasts a location update.
 *
 * Authorization rules:
 *  - admin  → receives ALL updates (workers + managers)
 *  - manager → receives worker updates from their own team
 *             AND their own manager updates (so their position appears
 *             instantly on the admin map without waiting for REST poll)
 *
 * The targetRole field indicates who produced the location:
 *   "worker"  → posted by a worker
 *   "manager" → posted by a manager
 */
export function broadcastLocationUpdate(payload: {
  workerId: string;
  teamId: string | null;
  targetRole: "worker" | "manager";
  sessionId: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  capturedAt: string;
  isDelayed: boolean;
}) {
  const message = JSON.stringify({
    type: "location:update",
    data: {
      workerId:  payload.workerId,
      sessionId: payload.sessionId,
      latitude:  payload.latitude,
      longitude: payload.longitude,
      accuracyM: payload.accuracyM,
      capturedAt: payload.capturedAt,
      isDelayed: payload.isDelayed,
    },
  });

  for (const entry of managerSockets) {
    let authorized = false;

    if (entry.role === "admin") {
      // Admin sees every role's location
      authorized = true;
    } else if (entry.role === "manager") {
      if (payload.targetRole === "worker" && entry.teamId === payload.teamId) {
        // Manager sees their own team's workers
        authorized = true;
      } else if (payload.targetRole === "manager" && entry.userId === payload.workerId) {
        // Manager sees their OWN location echoed back (for multi-tab) — not strictly
        // needed, but harmless.  The important path is the admin receiving it.
        authorized = true;
      }
    }

    if (authorized && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(message);
    }
  }
}

export function broadcastSessionEvent(payload: {
  type: "session:started" | "session:ended";
  workerId: string;
  teamId: string | null;
  targetRole: "worker" | "manager";
  sessionId: string;
}) {
  const message = JSON.stringify({ type: payload.type, data: payload });
  for (const entry of managerSockets) {
    let authorized = false;
    if (entry.role === "admin") {
      authorized = true;
    } else if (entry.role === "manager") {
      // Manager gets session events for their own team's workers
      if (payload.targetRole === "worker" && entry.teamId === payload.teamId) {
        authorized = true;
      }
      // Manager gets their own session events too
      if (entry.userId === payload.workerId) {
        authorized = true;
      }
    }
    if (authorized && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(message);
    }
  }
}
