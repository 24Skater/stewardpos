const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function updatePassword() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'stewardpos',
    user: process.env.DB_USER || 'stewardpos_user',
    password: process.env.DB_PASSWORD,
  });

  try {
    const passwordHash = await bcrypt.hash('DemoPass!1', 10);
    
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE email = $2',
      [passwordHash, 'admin@demo.local']
    );

    if (result.rowCount > 0) {
      console.log('✅ Password updated successfully');
    } else {
      console.log('⚠️  No user found to update');
    }

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating password:', error.message);
    await pool.end();
    process.exit(1);
  }
}

updatePassword();

