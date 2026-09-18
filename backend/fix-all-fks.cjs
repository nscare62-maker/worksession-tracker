const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.ihzemkmhebjcbscshvlk:WorkSession2026!@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Applying ON DELETE CASCADE / SET NULL to all remaining user FKs...\n');

    // 1. location_updates.worker_id -> users.id (CASCADE)
    try {
      await client.query(`
        ALTER TABLE location_updates
          DROP CONSTRAINT IF EXISTS location_updates_worker_id_fkey,
          ADD CONSTRAINT location_updates_worker_id_fkey
            FOREIGN KEY (worker_id) REFERENCES users(id) ON DELETE CASCADE;
      `);
      console.log('✅ location_updates.worker_id -> ON DELETE CASCADE');
    } catch (e) {
      console.error('location_updates.worker_id:', e.message);
    }

    // 2. audit_log.actor_id -> users.id (SET NULL so audit trail isn't broken)
    try {
      await client.query(`
        ALTER TABLE audit_log
          DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey,
          ADD CONSTRAINT audit_log_actor_id_fkey
            FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;
      `);
      console.log('✅ audit_log.actor_id -> ON DELETE SET NULL');
    } catch (e) {
      console.error('audit_log.actor_id:', e.message);
    }

    // 3. manager_team_access.granted_by -> users.id (SET NULL)
    try {
      await client.query(`
        ALTER TABLE manager_team_access
          DROP CONSTRAINT IF EXISTS manager_team_access_granted_by_fkey,
          ADD CONSTRAINT manager_team_access_granted_by_fkey
            FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL;
      `);
      console.log('✅ manager_team_access.granted_by -> ON DELETE SET NULL');
    } catch (e) {
      console.error('manager_team_access.granted_by:', e.message);
    }

    // 4. retention_settings.updated_by -> users.id (SET NULL)
    try {
      await client.query(`
        ALTER TABLE retention_settings
          DROP CONSTRAINT IF EXISTS retention_settings_updated_by_fkey,
          ADD CONSTRAINT retention_settings_updated_by_fkey
            FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
      `);
      console.log('✅ retention_settings.updated_by -> ON DELETE SET NULL');
    } catch (e) {
      console.error('retention_settings.updated_by:', e.message);
    }

  } catch (err) {
    console.error('General error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
