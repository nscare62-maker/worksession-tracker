const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.ihzemkmhebjcbscshvlk:WorkSession2026!@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
  max: 1
});

async function main() {
  const c = await pool.connect();
  try {
    console.log('\n=== Supabase Database Verification ===\n');

    // Tables
    const { rows: tables } = await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
    console.log(`Tables (${tables.length}):`);
    tables.forEach(t => console.log(`  ✓ ${t.tablename}`));

    // Users
    const { rows: users } = await c.query(`SELECT email, role, full_name FROM users ORDER BY role, email`);
    console.log(`\nUsers (${users.length}):`);
    users.forEach(u => console.log(`  ${u.role.padEnd(9)} ${u.email.padEnd(28)} ${u.full_name}`));

    // Activity log
    const { rows: acts } = await c.query(`SELECT event_type, user_email, created_at FROM activity_log ORDER BY created_at DESC LIMIT 20`);
    console.log(`\nActivity Log (${acts.length} recent rows):`);
    acts.forEach(a => console.log(`  [${a.event_type.padEnd(18)}] ${(a.user_email||'').padEnd(28)} ${new Date(a.created_at).toLocaleTimeString()}`));

    // Sessions
    const { rows: sessions } = await c.query(`SELECT ws.id, u.email, ws.status, ws.started_at, ws.ended_at FROM work_sessions ws JOIN users u ON u.id = ws.worker_id ORDER BY ws.started_at DESC LIMIT 10`);
    console.log(`\nWork Sessions (${sessions.length} total):`);
    sessions.forEach(s => console.log(`  ${s.status.padEnd(12)} ${s.email.padEnd(28)} ${new Date(s.started_at).toLocaleTimeString()}${s.ended_at ? ' → '+new Date(s.ended_at).toLocaleTimeString() : ' (active)'}`));

    // Locations
    const { rows: locs } = await c.query(`SELECT lu.latitude, lu.longitude, lu.accuracy_m, lu.captured_at, u.email FROM location_updates lu JOIN users u ON u.id = lu.worker_id ORDER BY lu.captured_at DESC LIMIT 10`);
    console.log(`\nLocation Updates (${locs.length} recent):`);
    locs.forEach(l => console.log(`  ${l.email.padEnd(28)} lat=${Number(l.latitude).toFixed(4)} lng=${Number(l.longitude).toFixed(4)} acc=${l.accuracy_m}m`));

    console.log('\n✅ Supabase fully operational!\n');
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
