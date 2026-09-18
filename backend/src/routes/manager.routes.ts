import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { validateBody } from "../middleware/validate";
import { z } from "zod";
import {
  createManagedUser,
  getLivePositions,
  listWorkerSessions,
  listWorkers,
  listCredentials,
  deleteUser,
} from "../controllers/manager.controller";

const router = Router();

const createUserSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(2),
  role:     z.enum(["worker", "manager"]),
  teamId:   z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
});

router.post(  "/users",                      authenticate, requireRole("manager","admin"), validateBody(createUserSchema), asyncHandler(createManagedUser));
router.delete("/users/:userId",               authenticate, requireRole("admin"),           asyncHandler(deleteUser));
router.get(   "/positions/live",             authenticate, requireRole("manager","admin"), asyncHandler(getLivePositions));
router.get(   "/workers",                    authenticate, requireRole("manager","admin"), asyncHandler(listWorkers));
router.get(   "/workers/:workerId/sessions", authenticate, requireRole("manager","admin"), asyncHandler(listWorkerSessions));
router.get(   "/credentials",                authenticate, requireRole("admin"),           asyncHandler(listCredentials));

// Teams list for the Add User form
router.get("/teams", authenticate, requireRole("manager","admin"), asyncHandler(async (_req, res) => {
  const { pool } = await import("../db/pool");
  const { rows } = await pool.query("SELECT id, name FROM teams ORDER BY name");
  res.json({ teams: rows });
}));

export default router;
