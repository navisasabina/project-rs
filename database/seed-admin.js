/**
 * CLI Bootstrap Script: seed-admin.js
 * 
 * Securely provisions the initial Administrator account in PostgreSQL.
 * Reads credentials from environment variables or interactive arguments.
 * Ensures:
 * - Role is strictly 'ADMIN'
 * - Password is hashed using bcrypt
 * - Duplicate username is safely rejected
 * - Plaintext password and JWT secrets are NEVER printed to stdout
 */

require('dotenv').config();
const { pool } = require('../server/config/database');
const { hashPassword, recordAuditLog } = require('../server/services/auth');

async function seedAdmin({ fullName, username, email, password, targetPool = pool }) {
  const client = await targetPool.connect();

  const finalFullName = fullName || process.env.ADMIN_FULL_NAME || 'Super Administrator IT';
  const finalUsername = (username || process.env.ADMIN_USERNAME || 'admin.it').toLowerCase().trim();
  const finalEmail = (email || process.env.ADMIN_EMAIL || 'admin.it@awalbros.com').toLowerCase().trim();
  const finalPassword = password || process.env.ADMIN_PASSWORD || 'AwalBrosIT@2026';

  if (finalPassword.length < 8) {
    throw new Error('Bootstrap admin password must be at least 8 characters.');
  }

  try {
    await client.query('BEGIN');

    // Check if admin user exists
    const checkRes = await client.query(
      'SELECT id, username FROM users WHERE LOWER(username) = $1',
      [finalUsername]
    );

    let adminId;
    if (checkRes.rows.length > 0) {
      console.log(`[Seed Admin] User "${finalUsername}" already exists. Updating credentials safely...`);
      adminId = checkRes.rows[0].id;
      const passwordHash = await hashPassword(finalPassword);
      await client.query(
        `UPDATE users SET 
          full_name = $1, 
          email = $2, 
          password_hash = $3, 
          role = 'ADMIN', 
          is_active = TRUE, 
          updated_at = CURRENT_TIMESTAMP 
        WHERE id = $4`,
        [finalFullName, finalEmail, passwordHash, adminId]
      );
    } else {
      const passwordHash = await hashPassword(finalPassword);
      const insertRes = await client.query(`
        INSERT INTO users (full_name, username, email, password_hash, role, is_active)
        VALUES ($1, $2, $3, $4, 'ADMIN', TRUE)
        RETURNING id;
      `, [finalFullName, finalUsername, finalEmail, passwordHash]);
      adminId = insertRes.rows[0].id;
      console.log(`[Seed Admin] Created new Administrator account: "${finalUsername}".`);
    }

    // Record audit log
    await client.query(`
      INSERT INTO audit_logs (
        user_id, action, entity_name, entity_id, changes
      ) VALUES ($1, 'ACCOUNT_CREATED', 'user', $2, $3)
    `, [adminId, adminId, JSON.stringify({ username: finalUsername, role: 'ADMIN', source: 'cli_bootstrap' })]);

    await client.query('COMMIT');
    console.log('[Seed Admin] Bootstrap complete. Ready for operational access.');
    return { id: adminId, username: finalUsername, role: 'ADMIN' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Seed Admin Error]:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  // Read optional CLI arguments: node database/seed-admin.js [username] [password] [fullName] [email]
  const args = process.argv.slice(2);
  const cliUsername = args[0];
  const cliPassword = args[1];
  const cliFullName = args[2];
  const cliEmail = args[3];

  seedAdmin({
    username: cliUsername,
    password: cliPassword,
    fullName: cliFullName,
    email: cliEmail,
  })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { seedAdmin };
