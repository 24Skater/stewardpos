const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'stewardpos',
  user: process.env.DB_USER || 'stewardpos_user',
  password: process.env.DB_PASSWORD || 'stewardpos_secure_password_123',
});

async function fixPassword() {
  try {
    console.log('Generating password hash...');
    const passwordHash = await bcrypt.hash('DemoPass!1', 10);
    console.log('Hash generated:', passwordHash.substring(0, 30) + '...');
    
    console.log('Updating user password...');
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE email = $2',
      [passwordHash, 'admin@demo.local']
    );
    
    console.log('Rows updated:', result.rowCount);
    
    // Verify the password
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE email = $1',
      ['admin@demo.local']
    );
    
    if (userResult.rows.length > 0) {
      const storedHash = userResult.rows[0].password_hash;
      const matches = await bcrypt.compare('DemoPass!1', storedHash);
      console.log('Password verification:', matches ? '✅ MATCHES' : '❌ DOES NOT MATCH');
    }
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

fixPassword();

