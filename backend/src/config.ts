import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",

  databaseUrl: required("DATABASE_URL"),

  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",

  defaultUpdateIntervalSec: Number(process.env.DEFAULT_UPDATE_INTERVAL_SEC ?? 60),
  defaultDistanceFilterM: Number(process.env.DEFAULT_DISTANCE_FILTER_M ?? 100),
  staleThresholdSec: Number(process.env.STALE_THRESHOLD_SEC ?? 180),

  locationRetentionDays: Number(process.env.LOCATION_RETENTION_DAYS ?? 90),

  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 120),

  consentPolicyVersion: process.env.CONSENT_POLICY_VERSION ?? "unspecified",
};
