// Full end-to-end backend test
const BASE = 'http://localhost:4000';

async function main() {
  // 1. Admin login
  const adminRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gmail.com', password: 'admin@123' })
  });
  const adminData = await adminRes.json();
  const adminToken = adminData.token;
  console.log('1. Admin login:', adminRes.status === 200 ? 'OK' : 'FAIL', '| role:', adminData.user?.role);

  // 2. Manager login
  const mgrRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'manager@gmail.com', password: 'manager123' })
  });
  const mgrData = await mgrRes.json();
  const mgrToken = mgrData.token;
  console.log('2. Manager login:', mgrRes.status === 200 ? 'OK' : 'FAIL', '| role:', mgrData.user?.role);

  const ts = Date.now();

  // 3. Admin create employee
  const empRes = await fetch(`${BASE}/manager/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ email: `emp_${ts}@test.com`, password: 'Test1234!', fullName: `Test Emp ${ts}`, role: 'worker', teamId: '11111111-1111-1111-1111-111111111111' })
  });
  const empData = await empRes.json();
  console.log('3. Admin create employee:', empRes.status === 201 ? 'OK' : `FAIL(${empRes.status})`, empData.error || '');

  // 4. Admin create manager
  const mgrCreateRes = await fetch(`${BASE}/manager/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ email: `mgr_${ts}@test.com`, password: 'Test1234!', fullName: `Test Mgr ${ts}`, role: 'manager', teamId: '22222222-2222-2222-2222-222222222222' })
  });
  const mgrCreateData = await mgrCreateRes.json();
  console.log('4. Admin create manager:', mgrCreateRes.status === 201 ? 'OK' : `FAIL(${mgrCreateRes.status})`, mgrCreateData.error || '');

  // 5. Manager create employee (allowed)
  const empByMgrRes = await fetch(`${BASE}/manager/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mgrToken}` },
    body: JSON.stringify({ email: `empbymgr_${ts}@test.com`, password: 'Test1234!', fullName: `Emp By Mgr ${ts}`, role: 'worker' })
  });
  const empByMgrData = await empByMgrRes.json();
  console.log('5. Manager create employee:', empByMgrRes.status === 201 ? 'OK' : `FAIL(${empByMgrRes.status})`, empByMgrData.error || '');

  // 6. Manager create manager (must be blocked - 403)
  const blockRes = await fetch(`${BASE}/manager/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mgrToken}` },
    body: JSON.stringify({ email: `mgrbymgr_${ts}@test.com`, password: 'Test1234!', fullName: 'Should Fail', role: 'manager' })
  });
  console.log('6. Manager->manager blocked (expect 403):', blockRes.status === 403 ? 'OK - BLOCKED correctly' : `FAIL - got ${blockRes.status}`);

  // 7. Credentials endpoint (admin only)
  const credsRes = await fetch(`${BASE}/manager/credentials`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const credsData = await credsRes.json();
  const newCred = credsData.credentials?.find(c => c.email === `emp_${ts}@test.com`);
  console.log('7. Credentials list:', credsRes.status === 200 ? 'OK' : `FAIL(${credsRes.status})`, '| total:', credsData.credentials?.length);
  console.log('8. New emp cred in Supabase:', newCred ? `YES - pw="${newCred.plain_password}"` : 'NOT FOUND');

  // 8. Manager cannot access credentials (must be 403)
  const credsMgrRes = await fetch(`${BASE}/manager/credentials`, {
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  console.log('9. Manager->credentials blocked (expect 403):', credsMgrRes.status === 403 ? 'OK - BLOCKED correctly' : `FAIL - got ${credsMgrRes.status}`);

  // 9. Teams endpoint works
  const teamsRes = await fetch(`${BASE}/manager/teams`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const teamsData = await teamsRes.json();
  console.log('10. Teams endpoint:', teamsRes.status === 200 ? 'OK' : `FAIL(${teamsRes.status})`, '| teams:', teamsData.teams?.map(t => t.name).join(', '));

  console.log('\n=== ALL TESTS DONE ===');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
