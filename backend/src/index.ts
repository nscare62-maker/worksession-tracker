import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { config } from "./config";
import { logger } from "./utils/logger";
import { apiRateLimit } from "./middleware/rateLimit";
import { initWebSocketServer } from "./ws/socket";
import { scheduleRetentionJob } from "./services/retention";

import authRoutes     from "./routes/auth.routes";
import sessionRoutes  from "./routes/session.routes";
import locationRoutes from "./routes/location.routes";
import managerRoutes  from "./routes/manager.routes";
import taskRoutes     from "./routes/task.routes";
import activityRoutes from "./routes/activity.routes";

const app = express();

app.use(helmet()); // sensible security headers
const configuredOrigins = (config.corsOrigin || "").split(",").map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      configuredOrigins.includes("*") ||
      configuredOrigins.includes(origin) ||
      origin.endsWith(".netlify.app") ||
      origin.endsWith(".railway.app") ||
      origin.endsWith(".onrender.com") ||
      origin.endsWith(".loca.lt") ||
      origin.startsWith("http://localhost:")
    ) {
      return callback(null, true);
    }
    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: "256kb" })); // location payloads are tiny; cap body size
app.use(pinoHttp({ logger }));
app.use(apiRateLimit);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth",     authRoutes);
app.use("/sessions", sessionRoutes);
app.use("/locations",locationRoutes);
app.use("/manager",  managerRoutes);
app.use("/tasks",    taskRoutes);
app.use("/activity", activityRoutes);

// Central error handler — never leak stack traces/internals to clients.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

const server = http.createServer(app);
initWebSocketServer(server);
scheduleRetentionJob();

server.listen(config.port, () => {
  logger.info(`API + WebSocket listening on port ${config.port} (${config.nodeEnv})`);
});
