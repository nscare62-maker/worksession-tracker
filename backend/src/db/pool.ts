import { Pool } from "pg";
import { config } from "../config";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  // In production, terminate TLS at the DB layer (e.g. `sslmode=require` in the URL,
  // or managed Postgres with enforced TLS) so data in transit is encrypted end-to-end.
  max: 20,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("Unexpected Postgres pool error", err);
});
