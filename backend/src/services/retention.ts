import { config } from "../config";
import { purgeExpiredLocations } from "./location.service";
import { logger } from "../utils/logger";

/** Runs once a day. In production, prefer a dedicated cron job / scheduled task
 *  over an in-process interval so it survives restarts and scales independently. */
export function scheduleRetentionJob() {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const deleted = await purgeExpiredLocations(config.locationRetentionDays);
      logger.info({ deleted, retentionDays: config.locationRetentionDays }, "Retention purge complete");
    } catch (err) {
      logger.error({ err }, "Retention purge failed");
    }
  }, ONE_DAY_MS);
}
