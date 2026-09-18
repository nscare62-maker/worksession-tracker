import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import {
  getMyActiveSession,
  getRouteHistory,
  punchIn,
  punchOut,
} from "../controllers/session.controller";

const router = Router();

const punchInSchema = z.object({
  clockMethod: z.enum(["gps", "manual_no_location"]).default("gps"),
});

router.post("/start", authenticate, requireRole("worker", "manager"), validateBody(punchInSchema), asyncHandler(punchIn));
router.post("/:sessionId/end", authenticate, requireRole("worker", "manager"), asyncHandler(punchOut));
router.get("/mine/active", authenticate, requireRole("worker", "manager"), asyncHandler(getMyActiveSession));

// Route history — managers/admins only, RBAC further enforced in controller (must own the worker's team)
router.get("/:sessionId/route", authenticate, requireRole("manager", "admin"), asyncHandler(getRouteHistory));

export default router;
