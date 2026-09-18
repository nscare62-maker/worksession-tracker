const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.ihzemkmhebjcbscshvlk:WorkSession2026!@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const user = await pool.query("SELECT id, email, full_name, role FROM users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002'");
  console.log('User aaaaaaaa-0000-0000-0000-000000000002:', user.rows);

  const sessions = await pool.query("SELECT id, worker_id, status FROM work_sessions WHERE worker_id = 'aaaaaaaa-0000-0000-0000-000000000002'");
  console.log('Sessions count:', sessions.rows.length);

  await pool.end();
}

main().catch(console.error);
