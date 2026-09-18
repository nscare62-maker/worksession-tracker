/**
 * migrate-supabase.ts
 * Connects to Supabase and runs the full migration + seed in one go.
 *
 * Usage:
 *   .\node_modules\.bin\tsx.cmd migrate-supabase.ts
 *
 * Reads DATABASE_URL from .env automatically.
 * Swap the DATABASE_URL in .env to point at Supabase before running.
 */
import "dotenv/config";
import { Pool } from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL =
  "postgresql://postgres.ihzemkmhebjcbscshvlk:WorkSession2026!@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres";

async function main() {
  console.log("\n🚀  WorkSession Tracker — Supabase Migration\n");

  const pool = new Pool({
    connectionString: SUPABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
    max: 1,
  });

  let client;
  try {
    client = await pool.connect();
    console.log("✓  Connected to Supabase Postgres");
  } catch (err: any) {
    console.error("✗  Cannot connect:", err.message);
    console.error("\n   Make sure your Supabase project is ACTIVE (not paused):");
    console.error("   https://supabase.com/dashboard/project/ihzemkmhebjcbscshvlk\n");
    process.exit(1);
  }

  try {
    // ── Run migration SQL ──────────────────────────────────────────────────
    const sql = fs.readFileSync(
      path.join(__dirname, "src/db/supabase_migration.sql"),
      "utf8"
    );
    await client.query(sql);
    console.log("✓  Schema + seed applied");

    // ── Verify ────────────────────────────────────────────────────────────
    const { rows: tables } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
    );
    console.log(`✓  Tables (${tables.length}): ${tables.map((r: any) => r.tablename).join(", ")}`);

    const { rows: users } = await client.query(
      `SELECT email, role FROM users ORDER BY role, email`
    );
    console.log(`✓  Users (${users.length}):`);
    users.forEach((u: any) =>
      console.log(`     ${u.role.padEnd(9)} ${u.email}`)
    );

    const { rows: al } = await client.query(
      `SELECT COUNT(*) FROM activity_log`
    );
    console.log(`✓  activity_log table ready (${al[0].count} rows)`);

    // ── Print the connection string for .env ──────────────────────────────
    console.log("\n✅  Migration complete!\n");
    console.log("   Now update your backend/.env:");
    console.log("   DATABASE_URL=" + SUPABASE_URL.replace(/:[^:@]+@/, ":****@"));
    console.log("\n   Then restart the backend:\n   Ctrl+C and npm run dev\n");
  } finally {
    client.release();
    await pool.end();
  }
}

main();
