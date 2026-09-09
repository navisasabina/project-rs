const fs = require('fs');
const path = require('path');
const { pool } = require('../server/config/database');

const MIGRATIONS_DIR = path.resolve(__dirname, '../database/migrations');

// Ensure schema_migrations tracker table exists
async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(100) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function runUp(targetPool = pool) {
  const client = await targetPool.connect();
  try {
    await ensureMigrationsTable(client);
    
    // Find all .up.sql files sorted alphabetically
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.up.sql'))
      .sort();

    const appliedResult = await client.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(appliedResult.rows.map(r => r.version));

    let count = 0;
    for (const file of files) {
      const version = file.replace('.up.sql', '');
      if (!appliedSet.has(version)) {
        console.log(`Applying migration UP: ${file}...`);
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        
        console.log(`Successfully applied: ${file}`);
        count++;
      }
    }

    if (count === 0) {
      console.log('Database is up to date. No pending migrations.');
    } else {
      console.log(`Completed ${count} migration(s).`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration UP failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function runDown(targetPool = pool) {
  const client = await targetPool.connect();
  try {
    await ensureMigrationsTable(client);

    // Get the latest applied migration
    const res = await client.query('SELECT version FROM schema_migrations ORDER BY id DESC LIMIT 1');
    if (res.rows.length === 0) {
      console.log('No migrations to rollback.');
      return;
    }

    const version = res.rows[0].version;
    const downFile = `${version}.down.sql`;
    const downPath = path.join(MIGRATIONS_DIR, downFile);

    if (!fs.existsSync(downPath)) {
      throw new Error(`Down migration file not found: ${downFile}`);
    }

    console.log(`Reverting migration DOWN: ${downFile}...`);
    const sql = fs.readFileSync(downPath, 'utf8');

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
    await client.query('COMMIT');

    console.log(`Successfully rolled back: ${downFile}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration DOWN failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function getStatus(targetPool = pool) {
  const client = await targetPool.connect();
  try {
    await ensureMigrationsTable(client);

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.up.sql'))
      .sort();

    const appliedResult = await client.query('SELECT version, applied_at FROM schema_migrations ORDER BY id ASC');
    const appliedMap = new Map(appliedResult.rows.map(r => [r.version, r.applied_at]));

    console.log('\n--- MIGRATION STATUS ---');
    for (const file of files) {
      const version = file.replace('.up.sql', '');
      const appliedAt = appliedMap.get(version);
      const status = appliedAt ? `APPLIED at ${appliedAt.toISOString()}` : 'PENDING';
      console.log(`[${status.padEnd(7)}] ${version}`);
    }
    console.log('------------------------\n');
  } finally {
    client.release();
  }
}

// CLI entrypoint if executed directly
if (require.main === module) {
  const command = process.argv[2] || 'status';

  (async () => {
    try {
      if (command === 'up') {
        await runUp();
      } else if (command === 'down') {
        await runDown();
      } else if (command === 'status') {
        await getStatus();
      } else {
        console.error(`Unknown command: "${command}". Use "up", "down", or "status".`);
        process.exit(1);
      }
      await pool.end();
      process.exit(0);
    } catch (err) {
      await pool.end().catch(() => {});
      process.exit(1);
    }
  })();
}

module.exports = {
  runUp,
  runDown,
  getStatus,
};
