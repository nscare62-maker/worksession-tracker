import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { locationRateLimit } from "../middleware/rateLimit";
import { asyncHandler } from "../utils/asyncHandler";
import { postLocationBatch, postLocationUpdate } from "../controllers/location.controller";

const router = Router();

const singleUpdateSchema = z.object({
  sessionId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().optional(),
  speedMps: z.number().optional(),
  headingDeg: z.number().min(0).max(360).optional(),
  capturedAt: z.string().datetime(),
  updateType: z.enum(["interval", "distance", "manual_ping", "queued_offline", "periodic"]),
  permissionState: z.enum(["granted", "denied", "restricted", "unknown"]).optional(),
});

const batchSchema = z.object({
  updates: z.array(singleUpdateSchema.omit({ updateType: true })).min(1).max(200),
});

router.post(
  "/",
  authenticate,
  requireRole("worker", "manager"),
  locationRateLimit,
  validateBody(singleUpdateSchema),
  asyncHandler(postLocationUpdate)
);

router.post(
  "/batch",
  authenticate,
  requireRole("worker", "manager"),
  locationRateLimit,
  validateBody(batchSchema),
  asyncHandler(postLocationBatch)
);

export default router;
