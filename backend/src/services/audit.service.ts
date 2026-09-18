import { pool } from "../db/pool";

export async function recordAudit(params: {
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}) {
  await pool.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.actorId,
      params.action,
      params.targetType ?? null,
      params.targetId ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.ipAddress ?? null,
    ]
  );
}
