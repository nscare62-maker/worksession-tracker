import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { config } from "../config";
import { recordAudit } from "../services/audit.service";
import { logActivity } from "../services/activity.service";

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as { email: string; password: string };

  const result = await pool.query(
    `SELECT id, email, password_hash, full_name, role, team_id, is_active FROM users WHERE email = $1`,
    [email]
  );
  const user = result.rows[0];
  const valid = user ? await bcrypt.compare(password, user.password_hash) : false;

  if (!user || !valid || !user.is_active) {
    // Log failed attempt too
    logActivity({
      eventType: "login",
      userEmail: email,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: { success: false, reason: "invalid_credentials" },
    });
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = jwt.sign(
    { sub: user.id, role: user.role, teamId: user.team_id, email: user.email },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"] }
  );

  await recordAudit({ actorId: user.id, action: "auth.login", ipAddress: req.ip });

  // Fire-and-forget activity log
  logActivity({
    eventType:  "login",
    userId:     user.id,
    userEmail:  user.email,
    userName:   user.full_name,
    userRole:   user.role,
    ipAddress:  req.ip,
    userAgent:  req.headers["user-agent"],
    metadata: { success: true, loginTime: new Date().toISOString() },
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      teamId: user.team_id,
    },
  });
}

export async function acknowledgeConsent(req: Request, res: Response) {
  const userId = req.user!.id;
  const { policyTextHash } = req.body as { policyTextHash: string };

  const result = await pool.query(
    `INSERT INTO consent_acks (user_id, policy_version, policy_text_hash, ip_address, device_info)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, policy_version, acknowledged_at`,
    [userId, config.consentPolicyVersion, policyTextHash, req.ip, req.body.deviceInfo ?? null]
  );

  await recordAudit({ actorId: userId, action: "consent.acknowledged", targetType: "consent_ack", targetId: result.rows[0].id });

  logActivity({
    eventType: "consent_ack",
    userId,
    ipAddress: req.ip,
    metadata: { policyVersion: config.consentPolicyVersion },
  });

  res.status(201).json(result.rows[0]);
}

export async function getConsentStatus(req: Request, res: Response) {
  const userId = req.user!.id;
  const result = await pool.query(
    `SELECT id, policy_version, acknowledged_at FROM consent_acks
     WHERE user_id = $1 AND policy_version = $2
     ORDER BY acknowledged_at DESC LIMIT 1`,
    [userId, config.consentPolicyVersion]
  );
  res.json({
    currentPolicyVersion: config.consentPolicyVersion,
    hasAcknowledgedCurrent: (result.rowCount ?? 0) > 0,
    ack: result.rows[0] ?? null,
  });
}
