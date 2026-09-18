import { Request, Response } from "express";
import { pool } from "../db/pool";
import { logActivity } from "../services/activity.service";

async function canAssignTo(actorId: string, actorRole: "admin" | "manager", assigneeId: string) {
  const result = await pool.query(
    `SELECT id, role, team_id FROM users WHERE id = $1 AND is_active = true`,
    [assigneeId]
  );
  const assignee = result.rows[0];
  if (!assignee) return false;
  if (actorRole === "admin") return assignee.role === "manager" || assignee.role === "worker";
  return assignee.role === "worker" && assignee.team_id === (await getUserTeam(actorId));
}

async function getUserTeam(userId: string) {
  const result = await pool.query(`SELECT team_id FROM users WHERE id = $1`, [userId]);
  return result.rows[0]?.team_id ?? null;
}

export async function createTask(req: Request, res: Response) {
  const actor   = req.user!;
  const allowed = await canAssignTo(actor.id, actor.role as "admin" | "manager", req.body.assignedTo);
  if (!allowed) return res.status(403).json({ error: "You cannot assign tasks to this account" });

  const result = await pool.query(
    `INSERT INTO tasks (title, description, assigned_by, assigned_to, due_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, description, assigned_by, assigned_to, status, due_at, completed_at, completion_report, created_at`,
    [req.body.title, req.body.description ?? null, actor.id, req.body.assignedTo, req.body.dueAt ?? null]
  );

  const assignee = await pool.query(`SELECT full_name, email FROM users WHERE id = $1`, [req.body.assignedTo]);
  logActivity({
    eventType: "task_assigned",
    userId:    actor.id,
    userEmail: actor.email,
    userRole:  actor.role,
    metadata: {
      taskId:        result.rows[0].id,
      taskTitle:     req.body.title,
      assignedTo:    req.body.assignedTo,
      assigneeName:  assignee.rows[0]?.full_name,
      assigneeEmail: assignee.rows[0]?.email,
    },
  });

  res.status(201).json({ task: result.rows[0] });
}

export async function listMyTasks(req: Request, res: Response) {
  const result = await pool.query(
    `SELECT t.*, assigner.full_name AS assigner_name, assignee.full_name AS assignee_name
     FROM tasks t
     JOIN users assigner ON assigner.id = t.assigned_by
     JOIN users assignee ON assignee.id = t.assigned_to
     WHERE t.assigned_to = $1 OR t.assigned_by = $1
     ORDER BY t.created_at DESC`,
    [req.user!.id]
  );
  res.json({ tasks: result.rows });
}

export async function completeTask(req: Request, res: Response) {
  const result = await pool.query(
    `UPDATE tasks
     SET status = 'completed', completed_at = now(), completion_report = $1
     WHERE id = $2 AND assigned_to = $3 AND status != 'completed'
     RETURNING id, title, status, completed_at, completion_report`,
    [req.body.report, req.params.taskId, req.user!.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Task not found or already completed" });

  logActivity({
    eventType: "task_completed",
    userId:    req.user!.id,
    userEmail: req.user!.email,
    userRole:  req.user!.role,
    metadata: {
      taskId:      req.params.taskId,
      taskTitle:   result.rows[0].title,
      report:      req.body.report,
      completedAt: result.rows[0].completed_at,
    },
  });

  res.json({ task: result.rows[0] });
}

export async function startTask(req: Request, res: Response) {
  const result = await pool.query(
    `UPDATE tasks SET status = 'in_progress'
     WHERE id = $1 AND assigned_to = $2 AND status = 'assigned'
     RETURNING id, status`,
    [req.params.taskId, req.user!.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Task not found or already started" });

  logActivity({
    eventType: "task_started",
    userId:    req.user!.id,
    userEmail: req.user!.email,
    userRole:  req.user!.role,
    metadata:  { taskId: req.params.taskId },
  });

  res.json({ task: result.rows[0] });
}
