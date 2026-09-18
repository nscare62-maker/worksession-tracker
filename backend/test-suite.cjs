const { Pool } = require('pg');

async function runTests() {
  const log = (msg, pass) => console.log((pass ? '✅ ' : '❌ ') + msg);
  let allPassed = true;

  try {
    const adminLoginRes = await fetch('http://localhost:4000/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@gmail.com', password: 'admin@123' })
    });
    const adminData = await adminLoginRes.json();
    const adminToken = adminData.token;
    const ok1 = adminLoginRes.status === 200 && adminData.user?.role === 'admin';
    log('1. Admin login succeeds (role: admin)', ok1);
    if (!ok1) allPassed = false;

    const teamsRes = await fetch('http://localhost:4000/manager/teams', {
      headers: { Authorization: 'Bearer ' + adminToken }
    });
    const teamsData = await teamsRes.json();
    const ok2 = teamsRes.status === 200 && Array.isArray(teamsData.teams) && teamsData.teams.length >= 2;
    log('2. Admin gets teams dynamically (count: ' + (teamsData.teams?.length ?? 0) + ')', ok2);
    if (!ok2) allPassed = false;
    const team1 = teamsData.teams[0].id;
    const team2 = teamsData.teams[1].id;

    const ts = Date.now();
    const mgrEmail = 'test_mgr_' + ts + '@example.com';
    const mgrPassword = 'Password!Mgr1';
    const createMgrRes = await fetch('http://localhost:4000/manager/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
      body: JSON.stringify({
        fullName: 'Automated Manager',
        email: mgrEmail,
        password: mgrPassword,
        role: 'manager',
        teamId: team1
      })
    });
    const createMgrData = await createMgrRes.json();
    const ok3 = createMgrRes.status === 201 && createMgrData.user?.role === 'manager' && createMgrData.user?.team_id === team1;
    log('3. Admin creates Manager with team assignment (201 Created)', ok3);
    if (!ok3) allPassed = false;

    const emp1Email = 'test_emp1_' + ts + '@example.com';
    const emp1Password = 'Password!Emp1';
    const createEmp1Res = await fetch('http://localhost:4000/manager/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
      body: JSON.stringify({
        fullName: 'Automated Worker Team 2',
        email: emp1Email,
        password: emp1Password,
        role: 'worker',
        teamId: team2
      })
    });
    const createEmp1Data = await createEmp1Res.json();
    const ok4 = createEmp1Res.status === 201 && createEmp1Data.user?.role === 'worker' && createEmp1Data.user?.team_id === team2;
    log('4. Admin creates Employee with team assignment (201 Created)', ok4);
    if (!ok4) allPassed = false;

    const emp2Email = 'test_emp2_' + ts + '@example.com';
    const emp2Password = 'Password!Emp2';
    const createEmp2Res = await fetch('http://localhost:4000/manager/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
      body: JSON.stringify({
        fullName: 'Automated Worker Unassigned',
        email: emp2Email,
        password: emp2Password,
        role: 'worker',
        teamId: ''
      })
    });
    const createEmp2Data = await createEmp2Res.json();
    const ok5 = createEmp2Res.status === 201 && createEmp2Data.user?.role === 'worker' && createEmp2Data.user?.team_id === null;
    log('5. Admin creates Employee with unassigned team (empty string -> null, 201 Created)', ok5);
    if (!ok5) allPassed = false;

    const credsRes = await fetch('http://localhost:4000/manager/credentials', {
      headers: { Authorization: 'Bearer ' + adminToken }
    });
    const credsData = await credsRes.json();
    const foundMgr = credsData.credentials?.find(c => c.email === mgrEmail);
    const foundEmp1 = credsData.credentials?.find(c => c.email === emp1Email);
    const foundEmp2 = credsData.credentials?.find(c => c.email === emp2Email);
    const ok6 = credsRes.status === 200 &&
      foundMgr?.plain_password === mgrPassword &&
      foundEmp1?.plain_password === emp1Password &&
      foundEmp2?.plain_password === emp2Password;
    log('6. Admin can view plain credentials for all newly created accounts', ok6);
    if (!ok6) allPassed = false;

    const mgrLoginRes = await fetch('http://localhost:4000/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: mgrEmail, password: mgrPassword })
    });
    const mgrLoginData = await mgrLoginRes.json();
    const newMgrToken = mgrLoginData.token;
    const ok7 = mgrLoginRes.status === 200 && mgrLoginData.user?.role === 'manager';
    log('7. Newly created manager logs in successfully', ok7);
    if (!ok7) allPassed = false;

    const empByMgrEmail = 'test_emp_bymgr_' + ts + '@example.com';
    const empByMgrPassword = 'Password!ByMgr';
    const createByMgrRes = await fetch('http://localhost:4000/manager/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + newMgrToken },
      body: JSON.stringify({
        fullName: 'Worker Created By Manager',
        email: empByMgrEmail,
        password: empByMgrPassword,
        role: 'worker'
      })
    });
    const createByMgrData = await createByMgrRes.json();
    const ok8 = createByMgrRes.status === 201 && createByMgrData.user?.role === 'worker' && createByMgrData.user?.team_id === team1;
    log('8. Manager creates Employee; auto-assigned to manager team (' + team1 + ')', ok8);
    if (!ok8) allPassed = false;

    const mgrByMgrRes = await fetch('http://localhost:4000/manager/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + newMgrToken },
      body: JSON.stringify({
        fullName: 'Disallowed Manager Role',
        email: 'bad_mgr_' + ts + '@example.com',
        password: 'Password!Bad',
        role: 'manager'
      })
    });
    const mgrByMgrData = await mgrByMgrRes.json();
    const ok9 = mgrByMgrRes.status === 403 && mgrByMgrData.error?.includes('Managers can only create employee');
    log('9. Manager attempting to create a manager is rejected with 403 Forbidden', ok9);
    if (!ok9) allPassed = false;

    const mgrCredsRes = await fetch('http://localhost:4000/manager/credentials', {
      headers: { Authorization: 'Bearer ' + newMgrToken }
    });
    const ok10 = mgrCredsRes.status === 403;
    log('10. Manager attempting to access credentials is rejected with 403 Forbidden', ok10);
    if (!ok10) allPassed = false;

    const pool = new Pool({
      connectionString: 'postgresql://postgres.ihzemkmhebjcbscshvlk:WorkSession2026!@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
      ssl: { rejectUnauthorized: false }
    });
    const dbRes = await pool.query(
      'SELECT email, plain_password, role, team_id, created_by_role FROM user_credentials WHERE email IN ($1, $2, $3, $4)',
      [mgrEmail, emp1Email, emp2Email, empByMgrEmail]
    );
    const ok11 = dbRes.rows.length === 4;
    log('11. Direct Supabase query confirms all 4 created users saved in user_credentials (' + dbRes.rows.length + '/4)', ok11);
    if (!ok11) allPassed = false;

    console.log('\nSupabase credentials records:');
    console.table(dbRes.rows);

    await pool.end();

    console.log('\nResult: ' + (allPassed ? '🎉 ALL 11 TESTS PASSED PERFECTLY!' : '❌ Some tests failed'));
  } catch (e) {
    console.error('Fatal error during test:', e);
    allPassed = false;
  }

  process.exit(allPassed ? 0 : 1);
}

runTests();
