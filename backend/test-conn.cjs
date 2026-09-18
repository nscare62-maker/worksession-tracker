const { Client } = require('pg');
const https = require('https');

const PROJECT = 'ihzemkmhebjcbscshvlk';
const PASSWORD = 'WorkSession2026!';

// All Supabase pooler regions
const REGIONS = [
  'aws-0-ap-south-1',
  'aws-0-ap-south-2',
  'aws-0-ap-southeast-1',
  'aws-0-ap-southeast-2',
  'aws-0-ap-northeast-1',
  'aws-0-ap-northeast-2',
  'aws-0-us-east-1',
  'aws-0-us-east-2',
  'aws-0-us-west-1',
  'aws-0-us-west-2',
  'aws-0-eu-west-1',
  'aws-0-eu-west-2',
  'aws-0-eu-west-3',
  'aws-0-eu-central-1',
  'aws-0-eu-north-1',
  'aws-0-ca-central-1',
  'aws-0-sa-east-1',
];

async function tryPooler(region, port) {
  const h = `${region}.pooler.supabase.com`;
  const c = new Client({
    host: h, port, 
    user: `postgres.${PROJECT}`,
    password: PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000
  });
  try {
    await c.connect();
    const r = await c.query('SELECT current_user');
    console.log(`\n✅ SUCCESS: ${h}:${port}`);
    console.log(`   user: ${r.rows[0].current_user}`);
    console.log(`\n   DATABASE_URL=postgresql://postgres.${PROJECT}:${PASSWORD}@${h}:${port}/postgres`);
    await c.end();
    return true;
  } catch(e) {
    process.stdout.write('.');
    await c.end().catch(()=>{});
    return false;
  }
}

async function main() {
  console.log('Testing all Supabase regions...\n');
  for (const region of REGIONS) {
    if (await tryPooler(region, 5432)) process.exit(0);
    if (await tryPooler(region, 6543)) process.exit(0);
  }
  
  // Also try direct with IPv4 forced
  console.log('\n\nTrying direct connection via Node DNS...');
  const dns = require('dns');
  dns.resolve4('db.' + PROJECT + '.supabase.co', async (err, addrs) => {
    if (err || !addrs?.length) {
      console.log('No IPv4 for direct host');
      console.error('\n\nAll attempts failed. Check Supabase project region in dashboard.');
      process.exit(1);
    }
    const ip = addrs[0];
    console.log(`IPv4: ${ip}`);
    const c = new Client({
      host: ip, port: 5432,
      user: 'postgres',
      password: PASSWORD,
      database: 'postgres',
      ssl: { rejectUnauthorized: false, servername: `db.${PROJECT}.supabase.co` },
      connectionTimeoutMillis: 10000
    });
    try {
      await c.connect();
      const r = await c.query('SELECT current_user');
      console.log(`\n✅ Direct IPv4 SUCCESS: ${ip}:5432 user=${r.rows[0].current_user}`);
      console.log(`\n   DATABASE_URL=postgresql://postgres:${PASSWORD}@${ip}:5432/postgres`);
      await c.end();
    } catch(e) {
      console.log(`Direct IPv4 FAIL: ${e.message}`);
      console.error('\nAll attempts failed.');
      process.exit(1);
    }
  });
}

main();
