import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { completeTask, createTask, listMyTasks, startTask } from "../controllers/task.controller";

const router = Router();
const createTaskSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  assignedTo: z.string().uuid(),
  dueAt: z.string().datetime().optional(),
});
const reportSchema = z.object({ report: z.string().min(2) });

router.get("/mine", authenticate, requireRole("admin", "manager", "worker"), asyncHandler(listMyTasks));
router.post("/", authenticate, requireRole("admin", "manager"), validateBody(createTaskSchema), asyncHandler(createTask));
router.post("/:taskId/start", authenticate, requireRole("manager", "worker"), asyncHandler(startTask));
router.post("/:taskId/complete", authenticate, requireRole("manager", "worker"), validateBody(reportSchema), asyncHandler(completeTask));

export default router;