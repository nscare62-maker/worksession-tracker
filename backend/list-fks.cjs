const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.ihzemkmhebjcbscshvlk:WorkSession2026!@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const query = `
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule
    FROM
      information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'users';
  `;

  const res = await pool.query(query);
  console.log('Foreign keys referencing users:');
  res.rows.forEach(r => {
    console.log(`  ${r.table_name}.${r.column_name} -> users.${r.foreign_column_name} [ON DELETE ${r.delete_rule}]`);
  });

  await pool.end();
}

main().catch(console.error);
