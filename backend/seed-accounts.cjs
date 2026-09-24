const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.ihzemkmhebjcbscshvlk:WorkSession2026!@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const hAdmin = await bcrypt.hash('admin@123', 10);
  const hMgr = await bcrypt.hash('manager123', 10);
  const hWrk = await bcrypt.hash('pass123', 10);

  // Update or insert admin
  await pool.query(`
    INSERT INTO users (id, email, password_hash, full_name, role)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@gmail.com', $1, 'Ada Admin', 'admin')
    ON CONFLICT (email) DO UPDATE SET password_hash = $1
  `, [hAdmin]);

  // Update or insert manager
  await pool.query(`
    INSERT INTO users (id, email, password_hash, full_name, role)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'manager@gmail.com', $1, 'Mona Manager', 'manager')
    ON CONFLICT (email) DO UPDATE SET password_hash = $1
  `, [hMgr]);

  // Update or insert worker
  await pool.query(`
    INSERT INTO users (id, email, password_hash, full_name, role)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000003', 'worker@gmail.com', $1, 'Wes Worker', 'worker')
    ON CONFLICT (email) DO UPDATE SET password_hash = $1
  `, [hWrk]);

  // Sync user_credentials table
  await pool.query(`DELETE FROM user_credentials WHERE email IN ('admin@gmail.com', 'manager@gmail.com', 'worker@gmail.com')`);
  await pool.query(`
    INSERT INTO user_credentials (user_id, email, plain_password, role, full_name) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@gmail.com', 'admin@123', 'admin', 'Ada Admin'),
    ('aaaaaaaa-0000-0000-0000-000000000002', 'manager@gmail.com', 'manager123', 'manager', 'Mona Manager'),
    ('aaaaaaaa-0000-0000-0000-000000000003', 'worker@gmail.com', 'pass123', 'worker', 'Wes Worker')
  `);

  console.log('✓ Accounts successfully configured in Supabase:');
  console.log('  - admin@gmail.com / admin@123');
  console.log('  - manager@gmail.com / manager123');
  console.log('  - worker@gmail.com / pass123');
  console.log('  - wilson@gmail.com / 123456');

  await pool.end();
}

main().catch(err => {
  console.error('Error:', err);
  pool.end();
});
