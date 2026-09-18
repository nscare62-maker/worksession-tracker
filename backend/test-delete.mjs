// Test delete user endpoint
const BASE = 'http://localhost:4000';

async function main() {
  // Admin login
  const adminRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gmail.com', password: 'admin@123' })
  });
  const adminData = await adminRes.json();
  const adminToken = adminData.token;
  console.log('Admin login:', adminRes.status === 200 ? 'OK' : 'FAIL');

  // Manager login
  const mgrRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'manager@gmail.com', password: 'manager123' })
  });
  const mgrData = await mgrRes.json();
  const mgrToken = mgrData.token;

  // Create a test user to delete
  const ts = Date.now();
  const createRes = await fetch(`${BASE}/manager/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ email: `delete_test_${ts}@test.com`, password: 'Test1234!', fullName: `Delete Test ${ts}`, role: 'worker', teamId: '11111111-1111-1111-1111-111111111111' })
  });
  const created = await createRes.json();
  const newUserId = created.user?.id;
  console.log('Created test user:', newUserId ? `OK (id: ${newUserId})` : `FAIL - ${JSON.stringify(created)}`);

  if (!newUserId) { console.log('Cannot test delete without userId'); return; }

  // Test: Manager CANNOT delete (should 403)
  const mgrDeleteRes = await fetch(`${BASE}/manager/users/${newUserId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  console.log('Manager delete blocked (expect 403):', mgrDeleteRes.status === 403 ? 'OK - BLOCKED' : `FAIL - got ${mgrDeleteRes.status}`);

  // Test: Admin CAN delete
  const deleteRes = await fetch(`${BASE}/manager/users/${newUserId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const deleteData = await deleteRes.json();
  console.log('Admin delete user:', deleteRes.status === 200 ? 'OK' : `FAIL(${deleteRes.status})`, deleteData.success ? `- deleted ${deleteData.deletedUser?.email}` : deleteData.error || '');

  // Verify user no longer in credentials
  const credsRes = await fetch(`${BASE}/manager/credentials`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const credsData = await credsRes.json();
  const stillExists = credsData.credentials?.find((c) => c.user_id === newUserId);
  console.log('Credentials removed from Supabase:', stillExists ? 'FAIL - still exists!' : 'OK - removed');

  // Test: Admin cannot delete themselves
  const selfDeleteRes = await fetch(`${BASE}/manager/users/${adminData.user.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  console.log('Self-delete blocked (expect 400):', selfDeleteRes.status === 400 ? 'OK - BLOCKED' : `FAIL - got ${selfDeleteRes.status}`);

  console.log('\n=== DELETE TESTS DONE ===');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
