import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth";
import { getRecentActivity } from "../services/activity.service";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

// Admin-only endpoint — returns last N activity log entries
router.get(
  "/",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    const rows  = await getRecentActivity(limit);
    res.json({ activities: rows });
  })
);

export default router;
