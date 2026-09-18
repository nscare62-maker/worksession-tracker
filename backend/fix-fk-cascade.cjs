const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.ihzemkmhebjcbscshvlk:WorkSession2026!@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Checking current constraints...');
    const checkBefore = await client.query(`
      SELECT conname, confdeltype 
      FROM pg_constraint 
      WHERE conname = 'work_sessions_worker_id_fkey';
    `);
    console.log('Before:', checkBefore.rows);
    // confdeltype: 'a' = NO ACTION, 'r' = RESTRICT, 'c' = CASCADE, 'n' = SET NULL, 'd' = SET DEFAULT

    console.log('\nApplying individual ALTER TABLE statements...');

    // 1. work_sessions.worker_id -> users.id
    try {
      await client.query(`
        ALTER TABLE work_sessions
          DROP CONSTRAINT IF EXISTS work_sessions_worker_id_fkey,
          ADD CONSTRAINT work_sessions_worker_id_fkey
            FOREIGN KEY (worker_id) REFERENCES users(id) ON DELETE CASCADE;
      `);
      console.log('✅ work_sessions.worker_id -> ON DELETE CASCADE');
    } catch (e) {
      console.error('❌ work_sessions.worker_id error:', e.message);
    }

    // 2. location_updates.session_id -> work_sessions.id
    try {
      await client.query(`
        ALTER TABLE location_updates
          DROP CONSTRAINT IF EXISTS location_updates_session_id_fkey,
          ADD CONSTRAINT location_updates_session_id_fkey
            FOREIGN KEY (session_id) REFERENCES work_sessions(id) ON DELETE CASCADE;
      `);
      console.log('✅ location_updates.session_id -> ON DELETE CASCADE');
    } catch (e) {
      console.error('❌ location_updates.session_id error:', e.message);
    }

    // 3. manager_team_access.manager_id -> users.id
    try {
      await client.query(`
        ALTER TABLE manager_team_access
          DROP CONSTRAINT IF EXISTS manager_team_access_manager_id_fkey,
          ADD CONSTRAINT manager_team_access_manager_id_fkey
            FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE;
      `);
      console.log('✅ manager_team_access.manager_id -> ON DELETE CASCADE');
    } catch (e) {
      console.error('❌ manager_team_access.manager_id error:', e.message);
    }

    // 4. tasks.assigned_to -> users.id
    try {
      await client.query(`
        ALTER TABLE tasks
          DROP CONSTRAINT IF EXISTS tasks_assigned_to_fkey,
          ADD CONSTRAINT tasks_assigned_to_fkey
            FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE CASCADE;
      `);
      console.log('✅ tasks.assigned_to -> ON DELETE CASCADE');
    } catch (e) {
      console.error('❌ tasks.assigned_to error:', e.message);
    }

    // 5. tasks.assigned_by -> users.id
    try {
      await client.query(`
        ALTER TABLE tasks
          DROP CONSTRAINT IF EXISTS tasks_assigned_by_fkey,
          ADD CONSTRAINT tasks_assigned_by_fkey
            FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE CASCADE;
      `);
      console.log('✅ tasks.assigned_by -> ON DELETE CASCADE');
    } catch (e) {
      console.error('❌ tasks.assigned_by error:', e.message);
    }

    // 6. user_credentials.user_id -> users.id
    try {
      await client.query(`
        ALTER TABLE user_credentials
          DROP CONSTRAINT IF EXISTS user_credentials_user_id_fkey,
          ADD CONSTRAINT user_credentials_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      `);
      console.log('✅ user_credentials.user_id -> ON DELETE CASCADE');
    } catch (e) {
      console.error('❌ user_credentials.user_id error:', e.message);
    }

    // 7. activity_log.user_id -> users.id (SET NULL or CASCADE)
    try {
      await client.query(`
        ALTER TABLE activity_log
          DROP CONSTRAINT IF EXISTS activity_log_user_id_fkey,
          ADD CONSTRAINT activity_log_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
      `);
      console.log('✅ activity_log.user_id -> ON DELETE SET NULL');
    } catch (e) {
      console.error('❌ activity_log.user_id error:', e.message);
    }

    console.log('\nChecking updated constraints...');
    const checkAfter = await client.query(`
      SELECT conname, confdeltype 
      FROM pg_constraint 
      WHERE conname IN (
        'work_sessions_worker_id_fkey',
        'location_updates_session_id_fkey',
        'manager_team_access_manager_id_fkey',
        'tasks_assigned_to_fkey',
        'tasks_assigned_by_fkey',
        'user_credentials_user_id_fkey',
        'activity_log_user_id_fkey'
      );
    `);
    console.log('After:');
    checkAfter.rows.forEach(r => {
      const type = r.confdeltype === 'c' ? 'CASCADE' : r.confdeltype === 'n' ? 'SET NULL' : r.confdeltype;
      console.log(`  - ${r.conname}: ${type}`);
    });

  } catch (err) {
    console.error('General error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
