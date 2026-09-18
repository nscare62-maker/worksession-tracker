// Netlify Function — wraps the Express backend as a serverless function
// Directly connected to Supabase PostgreSQL over SSL
const serverless = require("serverless-http");
const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const { Pool }   = require("pg");

// ── Config from Netlify env vars ──────────────────────────────────────────
const DB_URL      = process.env.DATABASE_URL || "postgresql://postgres.ihzemkmhebjcbscshvlk:WorkSession2026!@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres";
const JWT_SECRET  = process.env.JWT_SECRET  || "worksession-prod-secret-abc123xyz-supabase";
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || "12h";
const POLICY_VER  = process.env.CONSENT_POLICY_VERSION || "2026-09-v1";

// ── DB Pool ───────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 8000,
});

pool.on("error", (err) => {
  console.error("Postgres pool error:", err.message);
});

// ── Express App ──────────────────────────────────────────────────────────
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
}));
app.use(express.json({ limit: "256kb" }));

// ── Normalize request URL across Netlify redirects & direct invokes ───────
app.use((req, res, next) => {
  req.url = req.url.replace(/^\/\.netlify\/functions\/[^\/]+/, "");
  if (!req.url.startsWith("/api")) {
    req.url = "/api" + (req.url.startsWith("/") ? req.url : "/" + req.url);
  }
  next();
});

// ── Activity Logging Helper ──────────────────────────────────────────────
function logActivity(eventType, user, req, meta = {}) {
  pool.query(
    `INSERT INTO activity_log (event_type, user_id, user_email, user_name, user_role, ip_address, user_agent, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      eventType,
      user?.id || user?.sub || null,
      user?.email || null,
      user?.fullName || null,
      user?.role || null,
      req.ip || null,
      req.headers["user-agent"] || null,
      JSON.stringify(meta),
    ]
  ).catch(() => {});
}

// ── Middleware: JWT Auth ─────────────────────────────────────────────────
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token expired or invalid" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

// ── Health ───────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ ok: true, status: "healthy", timestamp: new Date().toISOString() }));

// ── AUTH ─────────────────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const result = await pool.query(
      `SELECT id, email, password_hash, full_name, role, team_id, is_active FROM users WHERE email = $1`,
      [email.trim().toLowerCase()]
    );
    const user = result.rows[0];
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!user || !valid || !user.is_active) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { sub: user.id, role: user.role, teamId: user.team_id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    logActivity("login", { id: user.id, email: user.email, fullName: user.full_name, role: user.role }, req, { success: true });

    res.json({
      token,
      user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role, teamId: user.team_id },
    });
  } catch (err) {
    console.error("login error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/auth/consent", authenticate, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, policy_version, acknowledged_at FROM consent_acks
       WHERE user_id = $1 AND policy_version = $2 ORDER BY acknowledged_at DESC LIMIT 1`,
      [req.user.sub, POLICY_VER]
    );
    res.json({ currentPolicyVersion: POLICY_VER, hasAcknowledgedCurrent: r.rowCount > 0, ack: r.rows[0] ?? null });
  } catch (err) {
    console.error("consent get error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/consent", authenticate, async (req, res) => {
  try {
    const { policyTextHash } = req.body;
    const r = await pool.query(
      `INSERT INTO consent_acks (user_id, policy_version, policy_text_hash, ip_address, device_info)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, policy_version, acknowledged_at`,
      [req.user.sub, POLICY_VER, policyTextHash || "hash", req.ip || null, req.body.deviceInfo ? JSON.stringify(req.body.deviceInfo) : null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error("consent post error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── SESSIONS ─────────────────────────────────────────────────────────────
app.post("/api/sessions/start", authenticate, async (req, res) => {
  try {
    const { clockMethod = "gps" } = req.body;
    const workerId = req.user.sub;

    const existing = await pool.query(
      `SELECT id, status, started_at, update_interval_sec, distance_filter_m, clock_method FROM work_sessions
       WHERE worker_id = $1 AND status = 'active' LIMIT 1`,
      [workerId]
    );
    if (existing.rows.length > 0) {
      return res.json({ session: { ...existing.rows[0], update_interval_sec: existing.rows[0].update_interval_sec || 60, distance_filter_m: existing.rows[0].distance_filter_m || 100 } });
    }

    // Retrieve or create valid consent ack (required NOT NULL foreign key in work_sessions)
    let ack = await pool.query(
      `SELECT id FROM consent_acks WHERE user_id = $1 AND policy_version = $2 ORDER BY acknowledged_at DESC LIMIT 1`,
      [workerId, POLICY_VER]
    );
    let ackId = ack.rows[0]?.id;
    if (!ackId) {
      const newAck = await pool.query(
        `INSERT INTO consent_acks (user_id, policy_version, policy_text_hash, ip_address)
         VALUES ($1, $2, 'default_hash', $3) RETURNING id`,
        [workerId, POLICY_VER, req.ip || null]
      );
      ackId = newAck.rows[0].id;
    }

    const r = await pool.query(
      `INSERT INTO work_sessions (worker_id, status, clock_method, update_interval_sec, distance_filter_m, consent_ack_id, started_at)
       VALUES ($1, 'active', $2, 60, 100, $3, NOW())
       RETURNING id, status, started_at, update_interval_sec, distance_filter_m, clock_method`,
      [workerId, clockMethod, ackId]
    );

    logActivity("punch_in", req.user, req, { sessionId: r.rows[0].id, clockMethod });

    res.json({ session: r.rows[0] });
  } catch (err) {
    console.error("punchIn error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/sessions/:id/end", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const workerId = req.user.sub;
    await pool.query(
      `UPDATE work_sessions SET status = 'ended', ended_at = NOW(), ended_reason = 'user_clock_out' WHERE id = $1 AND worker_id = $2 AND status = 'active'`,
      [id, workerId]
    );
    logActivity("punch_out", req.user, req, { sessionId: id });
    res.json({ ok: true });
  } catch (err) {
    console.error("punchOut error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/sessions/mine/active", authenticate, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, status, started_at, update_interval_sec, distance_filter_m, clock_method FROM work_sessions
       WHERE worker_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1`,
      [req.user.sub]
    );
    res.json({ session: r.rows[0] ?? null });
  } catch (err) {
    console.error("getMyActive error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/sessions/:id/route", authenticate, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, latitude, longitude, accuracy_m, speed_mps, heading_deg, captured_at, is_delayed, update_type
       FROM location_updates
       WHERE session_id = $1 ORDER BY captured_at ASC LIMIT 2000`,
      [req.params.id]
    );
    const route = r.rows.map(row => ({
      ...row,
      latitude: row.latitude != null ? Number(row.latitude) : null,
      longitude: row.longitude != null ? Number(row.longitude) : null,
      accuracy_m: row.accuracy_m != null ? Number(row.accuracy_m) : null,
      speed_mps: row.speed_mps != null ? Number(row.speed_mps) : null,
      heading_deg: row.heading_deg != null ? Number(row.heading_deg) : null,
    }));
    res.json({ route });
  } catch (err) {
    console.error("route error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── LOCATIONS ────────────────────────────────────────────────────────────
app.post("/api/locations", authenticate, async (req, res) => {
  try {
    const { sessionId, latitude, longitude, accuracyM, speedMps, headingDeg, capturedAt, updateType } = req.body;
    if (!sessionId || latitude == null || longitude == null) {
      return res.status(400).json({ error: "sessionId, latitude and longitude are required" });
    }

    const sessionCheck = await pool.query(
      `SELECT id, worker_id FROM work_sessions WHERE id = $1 AND status = 'active'`, [sessionId]
    );
    if (!sessionCheck.rows[0] || sessionCheck.rows[0].worker_id !== req.user.sub) {
      return res.status(404).json({ error: "Active session not found" });
    }

    if (accuracyM != null && accuracyM > 3000) {
      return res.status(422).json({ error: "low_accuracy" });
    }

    const capturedDate = capturedAt ? new Date(capturedAt) : new Date();
    const isDelayed = updateType === "queued_offline" || (Date.now() - capturedDate.getTime() > 90000);

    const insertResult = await pool.query(
      `INSERT INTO location_updates (session_id, worker_id, latitude, longitude, accuracy_m, speed_mps, heading_deg, captured_at, update_type, is_delayed, permission_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [sessionId, req.user.sub, latitude, longitude, accuracyM ?? null, speedMps ?? null, headingDeg ?? null,
       capturedDate.toISOString(), updateType ?? "interval", isDelayed, "granted"]
    );

    const locationId = insertResult.rows[0]?.id;
    if (locationId) {
      await pool.query(`UPDATE work_sessions SET last_location_id = $1 WHERE id = $2`, [locationId, sessionId]).catch(() => {});
    }

    res.json({ ok: true, locationId });
  } catch (err) {
    console.error("locations error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── MANAGER ───────────────────────────────────────────────────────────────
app.get("/api/manager/positions/live", authenticate, requireRole("admin", "manager"), async (req, res) => {
  try {
    const teamScope = req.user.role === "admin" ? "all" : (req.user.teamId ? [req.user.teamId] : []);
    const roleClause = teamScope === "all" ? "AND u.role IN ('manager', 'worker')" : "AND u.role = 'worker'";
    const teamClause = teamScope === "all" || teamScope.length === 0 ? "" : "AND (u.team_id = ANY($1) OR u.team_id IS NULL)";
    const params = teamScope === "all" || teamScope.length === 0 ? [] : [teamScope];

    const q = `
      SELECT DISTINCT ON (ws.worker_id)
             ws.id AS session_id, ws.worker_id, u.full_name, u.role, u.team_id, t.name AS team_name,
             ws.started_at, ws.update_interval_sec, ws.distance_filter_m,
             lu.id AS location_id, lu.latitude, lu.longitude,
             lu.accuracy_m, lu.captured_at, lu.received_at, lu.is_delayed, lu.permission_state
      FROM work_sessions ws
      JOIN users u ON u.id = ws.worker_id
      LEFT JOIN teams t ON t.id = u.team_id
      LEFT JOIN location_updates lu ON lu.id = ws.last_location_id
      WHERE ws.status = 'active' ${roleClause} ${teamClause}
      ORDER BY ws.worker_id, ws.started_at DESC
    `;

    const r = await pool.query(q, params);
    const positions = r.rows.map(row => ({
      session_id: row.session_id,
      worker_id: row.worker_id,
      full_name: row.full_name,
      worker_name: row.full_name,
      role: row.role || "worker",
      team_id: row.team_id,
      team_name: row.team_name || "General",
      started_at: row.started_at,
      update_interval_sec: row.update_interval_sec,
      distance_filter_m: row.distance_filter_m,
      location_id: row.location_id,
      latitude: row.latitude != null ? Number(row.latitude) : null,
      longitude: row.longitude != null ? Number(row.longitude) : null,
      accuracy_m: row.accuracy_m != null ? Number(row.accuracy_m) : null,
      captured_at: row.captured_at,
      received_at: row.received_at,
      is_delayed: row.is_delayed || (row.captured_at ? new Date(row.captured_at).getTime() < Date.now() - 180000 : false),
      permission_state: row.permission_state || "granted"
    }));
    res.json({ positions });
  } catch (err) {
    console.error("livePositions error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/manager/workers", authenticate, requireRole("admin", "manager"), async (req, res) => {
  try {
    const { q, status } = req.query;
    let query = `SELECT u.id, u.full_name, u.email, u.role, t.name AS team_name, ws.id AS active_session_id
                 FROM users u
                 LEFT JOIN teams t ON t.id = u.team_id
                 LEFT JOIN work_sessions ws ON ws.worker_id = u.id AND ws.status = 'active'
                 WHERE u.is_active = true AND u.role IN ('worker', 'manager')`;
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      query += ` AND (u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }
    if (status === "active")  query += ` AND ws.id IS NOT NULL`;
    if (status === "offline") query += ` AND ws.id IS NULL`;
    query += ` ORDER BY u.full_name`;

    const r = await pool.query(query, params);
    res.json({ workers: r.rows });
  } catch (err) {
    console.error("listWorkers error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/manager/workers/:id/sessions", authenticate, requireRole("admin", "manager"), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, status, started_at, ended_at, clock_method FROM work_sessions
       WHERE worker_id = $1 ORDER BY started_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json({ sessions: r.rows });
  } catch (err) {
    console.error("workerSessions error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/manager/users", authenticate, requireRole("admin", "manager"), async (req, res) => {
  try {
    const actor = req.user;
    const { email, password, fullName, role, teamId } = req.body;
    if (!email || !password || !fullName || !role) {
      return res.status(400).json({ error: "email, password, fullName and role are required" });
    }

    if (actor.role === "manager" && role !== "worker") {
      return res.status(403).json({ error: "Managers can only create employee accounts" });
    }

    const assignedTeamId = actor.role === "manager" ? actor.teamId : (teamId || null);

    const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email.trim().toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, team_id, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id, email, full_name, role, team_id, created_at`,
      [email.trim().toLowerCase(), hash, fullName.trim(), role, assignedTeamId]
    );
    const newUser = r.rows[0];

    // Save plain credentials for admin view
    await pool.query(
      `INSERT INTO user_credentials (user_id, email, plain_password, role, full_name, team_id, created_by, created_by_email, created_by_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [newUser.id, email.trim().toLowerCase(), password, role, fullName.trim(), assignedTeamId, actor.sub, actor.email, actor.role]
    ).catch(err => console.error("Save credentials error:", err.message));

    logActivity("user_created", actor, req, { newUserId: newUser.id, email: newUser.email, role, fullName });

    res.status(201).json({ user: newUser });
  } catch (err) {
    console.error("createUser error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/manager/credentials", authenticate, requireRole("admin"), async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, user_id, email, plain_password, role, full_name, team_id, created_by_email, created_at
       FROM user_credentials ORDER BY created_at DESC`
    );
    res.json({ credentials: r.rows });
  } catch (err) {
    console.error("credentials error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/manager/users/:userId", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const { userId } = req.params;
    await pool.query(`DELETE FROM user_credentials WHERE user_id = $1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM location_updates WHERE worker_id = $1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM work_sessions WHERE worker_id = $1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM tasks WHERE assigned_to = $1 OR assigned_by = $1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("deleteUser error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/manager/teams", authenticate, requireRole("admin", "manager"), async (_req, res) => {
  try {
    const r = await pool.query(`SELECT id, name FROM teams ORDER BY name`);
    res.json({ teams: r.rows });
  } catch (err) {
    console.error("teams error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── TASKS ─────────────────────────────────────────────────────────────────
app.get("/api/tasks/mine", authenticate, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT t.id, t.title, t.description, t.status, t.due_at, t.completed_at, t.completion_report, t.created_at,
              u.full_name AS assigner_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_by
       WHERE t.assigned_to = $1 ORDER BY t.created_at DESC`,
      [req.user.sub]
    );
    res.json({ tasks: r.rows });
  } catch (err) {
    console.error("getTasks error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/tasks", authenticate, requireRole("admin", "manager"), async (req, res) => {
  try {
    const { title, description, assignedTo } = req.body;
    if (!title || !assignedTo) return res.status(400).json({ error: "title and assignedTo are required" });

    const r = await pool.query(
      `INSERT INTO tasks (title, description, assigned_by, assigned_to, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW()) RETURNING *`,
      [title.trim(), description || "", req.user.sub, assignedTo]
    );
    res.status(201).json({ task: r.rows[0] });
  } catch (err) {
    console.error("createTask error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/tasks/:id/start", authenticate, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE tasks SET status = 'in_progress' WHERE id = $1 AND assigned_to = $2 RETURNING *`,
      [req.params.id, req.user.sub]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "Task not found" });
    res.json({ task: r.rows[0] });
  } catch (err) {
    console.error("startTask error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/tasks/:id/complete", authenticate, async (req, res) => {
  try {
    const { report } = req.body;
    const r = await pool.query(
      `UPDATE tasks SET status = 'completed', completed_at = NOW(), completion_report = $1 WHERE id = $2 AND assigned_to = $3 RETURNING *`,
      [report || "", req.params.id, req.user.sub]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "Task not found" });
    res.json({ task: r.rows[0] });
  } catch (err) {
    console.error("completeTask error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── ACTIVITY LOG (ADMIN ONLY) ─────────────────────────────────────────────
app.get("/api/activity", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const r = await pool.query(
      `SELECT id, event_type, user_id, user_email, user_name, user_role, session_id, latitude, longitude, accuracy_m, ip_address, user_agent, metadata, created_at
       FROM activity_log ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ logs: r.rows });
  } catch (err) {
    console.error("activity error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Fallback 404 ─────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Not found", path: req.url }));

// ── Netlify Function Handler ──────────────────────────────────────────────
const handler = serverless(app);
module.exports = { handler };
