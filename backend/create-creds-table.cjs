// Run once to create user_credentials table in Supabase
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres.ihzemkmhebjcbscshvlk:WorkSession2026!@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }, max: 1,
});
pool.connect().then(async c => {
  await c.query(`
    CREATE TABLE IF NOT EXISTS user_credentials (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL,
      email            TEXT NOT NULL,
      plain_password   TEXT NOT NULL,
      role             TEXT NOT NULL,
      full_name        TEXT NOT NULL,
      team_id          UUID,
      created_by       UUID,
      created_by_email TEXT,
      created_by_role  TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_creds_user    ON user_credentials(user_id);
    CREATE INDEX IF NOT EXISTS idx_creds_created ON user_credentials(created_at DESC);
  `);
  console.log('✓ user_credentials table ready in Supabase');
  const { rows } = await c.query(`SELECT COUNT(*) FROM user_credentials`);
  console.log('  Existing rows:', rows[0].count);
  c.release(); await pool.end();
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
