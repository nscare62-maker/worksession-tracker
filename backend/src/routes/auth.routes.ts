import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate";
import { authenticate } from "../middleware/auth";
import { authRateLimit } from "../middleware/rateLimit";
import { login, acknowledgeConsent, getConsentStatus } from "../controllers/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", authRateLimit, validateBody(loginSchema), asyncHandler(login));

const consentSchema = z.object({
  policyTextHash: z.string().min(1),
  deviceInfo: z.record(z.any()).optional(),
});

router.get("/consent", authenticate, asyncHandler(getConsentStatus));
router.post("/consent", authenticate, validateBody(consentSchema), asyncHandler(acknowledgeConsent));

export default router;
