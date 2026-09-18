const BASE = 'http://localhost:4000';

async function main() {
  const adminRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gmail.com', password: 'admin@123' })
  });
  const adminData = await adminRes.json();
  const adminToken = adminData.token;

  // 1. Create a user
  const ts = Date.now();
  const createRes = await fetch(`${BASE}/manager/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ email: `ws_cascade_${ts}@test.com`, password: 'Password123!', fullName: `Cascade Worker ${ts}`, role: 'worker', teamId: '11111111-1111-1111-1111-111111111111' })
  });
  const created = await createRes.json();
  const workerId = created.user?.id;
  console.log('Worker created:', workerId);

  // 2. Punch in / create work session for this user
  const workerLoginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `ws_cascade_${ts}@test.com`, password: 'Password123!' })
  });
  const workerData = await workerLoginRes.json();
  const workerToken = workerData.token;

  const punchInRes = await fetch(`${BASE}/sessions/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
    body: JSON.stringify({ clockMethod: 'gps' })
  });
  const punchData = await punchInRes.json();
  console.log('Punch in status:', punchInRes.status, 'Session:', punchData);

  // 3. Post a location update for this session
  const locRes = await fetch(`${BASE}/locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
    body: JSON.stringify({
      locations: [
        {
          latitude: 12.9716,
          longitude: 77.5946,
          accuracyMeters: 10,
          capturedAt: new Date().toISOString()
        }
      ]
    })
  });
  console.log('Location update status:', locRes.status);

  // 4. Now Admin deletes the user (who has active work_session and location_updates in DB)
  const deleteRes = await fetch(`${BASE}/manager/users/${workerId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const delData = await deleteRes.json();
  console.log('Delete result status:', deleteRes.status, delData);
  if (deleteRes.status === 200) {
    console.log('✅ User with active work sessions and location updates deleted successfully with ON DELETE CASCADE!');
  } else {
    console.error('❌ Failed to delete user with work sessions:', delData);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
