/**
 * Automated Verification Script: test-disaster-recovery-m12.js
 * 
 * Comprehensive M12 Test Suite:
 * 1. Backup script exists and is callable.
 * 2. Backup configuration is valid.
 * 3. Backup file naming/recognition is safe.
 * 4. Retention behavior does not delete unrelated files.
 * 5. Restore refuses execution without explicit confirmation.
 * 6. Restore validates target/configuration.
 * 7. Safe seed does not overwrite existing SOP modifications.
 * 8. Safe seed does not delete existing custom steps.
 * 9. Repeated safe seeding remains idempotent.
 * 10. --force behavior is explicit and never automatic.
 * 11. docker-entrypoint.sh does not use --force.
 * 12. JWT fallback is rejected.
 * 13. docker-compose no longer contains a hardcoded JWT fallback.
 * 14. PostgreSQL port binds to 127.0.0.1.
 * 15. Pool timeout configuration exists.
 * 16. .env.example documents M12 settings.
 * 17. RUNBOOK.md exists and contains required operational sections.
 * 18. Live tooling and real PostgreSQL drill validation.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { newDb, DataType } = require('pg-mem');

// Module imports under test
const {
  runBackup,
  pruneOldBackups,
  getDbConfig,
  parseRetentionDays,
  generateBackupFilename,
  checkPgDumpTool,
  BACKUP_FILE_PREFIX,
  BACKUP_FILE_REGEX,
} = require('../database/backup');

const {
  runRestore,
  validateBackupFile,
  validateTargetDatabase,
  checkPsqlTool,
} = require('../database/restore');

const {
  seedSOPData,
  readSourceSOPData,
} = require('../database/seed-sop-data');

const {
  validateJwtSecret,
  INSECURE_SECRETS,
} = require('../server/services/auth');

const {
  poolConfig,
} = require('../server/config/database');

async function runM12TestSuite() {
  console.log('================================================================');
  console.log(' STARTING M12 DISASTER RECOVERY & OPERATIONAL VERIFICATION');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (!condition) {
      console.error(`  [FAIL] Test #${totalTests}: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
    passedTests++;
    console.log(`  [PASS] Test #${totalTests}: ${message}`);
  }

  // -------------------------------------------------------------------------
  // 1. Backup script exists and is callable
  // -------------------------------------------------------------------------
  console.log('--- 1. Backup Script Presence & Module Exports ---');
  const backupScriptPath = path.resolve(__dirname, '../database/backup.js');
  assert(fs.existsSync(backupScriptPath), 'database/backup.js exists on disk.');
  assert(typeof runBackup === 'function', 'runBackup is exported as a function.');
  assert(typeof pruneOldBackups === 'function', 'pruneOldBackups is exported as a function.');
  assert(typeof getDbConfig === 'function', 'getDbConfig is exported as a function.');

  // -------------------------------------------------------------------------
  // 2. Backup configuration is valid
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Backup Configuration & Retention Parsing ---');
  const cfg = getDbConfig();
  assert(cfg && typeof cfg.host === 'string', 'getDbConfig returns valid host.');
  assert(typeof cfg.database === 'string' && cfg.database.length > 0, 'getDbConfig returns valid database name.');
  assert(typeof cfg.user === 'string' && cfg.user.length > 0, 'getDbConfig returns valid user.');
  assert(typeof cfg.port === 'number' && cfg.port > 0, 'getDbConfig returns valid numeric port.');

  assert(parseRetentionDays(14) === 14, 'parseRetentionDays correctly parses numeric 14.');
  assert(parseRetentionDays('30') === 30, 'parseRetentionDays correctly parses string "30".');
  assert(parseRetentionDays('invalid') === 7, 'parseRetentionDays safely falls back to 7 on NaN input.');
  assert(parseRetentionDays(-10) === 7, 'parseRetentionDays safely falls back to 7 on negative input.');

  // -------------------------------------------------------------------------
  // 3. Backup file naming and recognition is safe
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Backup Filename Generation & Recognition Regex ---');
  const generatedName = generateBackupFilename();
  assert(generatedName.startsWith(BACKUP_FILE_PREFIX), `Filename starts with prefix "${BACKUP_FILE_PREFIX}".`);
  assert(generatedName.endsWith('.sql'), 'Filename ends with ".sql".');
  assert(BACKUP_FILE_REGEX.test(generatedName), `Filename "${generatedName}" matches BACKUP_FILE_REGEX.`);

  // Safe pattern tests: only project backups are matched
  assert(BACKUP_FILE_REGEX.test('rs_awal_bros_kb_backup_2026-09-11_14-30-00.sql'), 'Valid backup filename is accepted.');
  assert(!BACKUP_FILE_REGEX.test('notes.txt'), 'Unrelated text file "notes.txt" is rejected.');
  assert(!BACKUP_FILE_REGEX.test('custom_dump.sql'), 'Arbitrary SQL file "custom_dump.sql" is rejected.');
  assert(!BACKUP_FILE_REGEX.test('.gitkeep'), 'Dotfile ".gitkeep" is rejected.');
  assert(!BACKUP_FILE_REGEX.test('rs_awal_bros_kb_backup_2026-09-11_14-30-00.sql.bak'), 'File with extra extension is rejected.');
  assert(!BACKUP_FILE_REGEX.test('rs_awal_bros_kb_backup_evil;rm.sql'), 'Malicious filename injection is rejected.');

  // -------------------------------------------------------------------------
  // 4. Retention behavior does not delete unrelated files
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Backup Retention Pruning Safety ---');
  const testBackupDir = path.resolve(__dirname, '../backups_test_temp_' + Date.now());
  fs.mkdirSync(testBackupDir, { recursive: true });

  const oldBackupFile = path.join(testBackupDir, 'rs_awal_bros_kb_backup_2020-01-01_00-00-00.sql');
  const newBackupFile = path.join(testBackupDir, 'rs_awal_bros_kb_backup_2099-01-01_00-00-00.sql');
  const unrelatedTextFile = path.join(testBackupDir, 'critical_handover_notes.txt');
  const unrelatedSqlFile = path.join(testBackupDir, 'manual_hospital_migration.sql');
  const gitkeepFile = path.join(testBackupDir, '.gitkeep');

  fs.writeFileSync(oldBackupFile, '-- Old backup 2020');
  fs.writeFileSync(newBackupFile, '-- New backup 2099');
  fs.writeFileSync(unrelatedTextFile, 'Do not delete this operational note.');
  fs.writeFileSync(unrelatedSqlFile, '-- Important standalone schema');
  fs.writeFileSync(gitkeepFile, '');

  // Simulate old file timestamp (30 days ago)
  const thirtyDaysAgo = (Date.now() - (30 * 24 * 60 * 60 * 1000)) / 1000;
  fs.utimesSync(oldBackupFile, thirtyDaysAgo, thirtyDaysAgo);

  const pruneResult = pruneOldBackups(testBackupDir, 7);
  assert(pruneResult.pruned.length === 1, 'Exactly 1 expired backup file was pruned.');
  assert(pruneResult.pruned[0].file === 'rs_awal_bros_kb_backup_2020-01-01_00-00-00.sql', 'The expired backup file was pruned.');
  assert(!fs.existsSync(oldBackupFile), 'Expired backup was deleted from disk.');
  assert(fs.existsSync(newBackupFile), 'Fresh backup was kept intact.');
  assert(fs.existsSync(unrelatedTextFile), 'Unrelated text file was NOT deleted.');
  assert(fs.existsSync(unrelatedSqlFile), 'Unrelated SQL file was NOT deleted.');
  assert(fs.existsSync(gitkeepFile), '.gitkeep file was NOT deleted.');

  // Clean up temp directory
  fs.rmSync(testBackupDir, { recursive: true, force: true });

  // -------------------------------------------------------------------------
  // 5. Restore refuses execution without explicit confirmation
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Restore Confirmation Guard ---');
  let restoreRefusalCaught = false;
  try {
    await runRestore('some_backup.sql', { confirm: false });
  } catch (err) {
    restoreRefusalCaught = true;
    assert(err.message.includes('Restore confirmation required') || err.message.includes('--confirm'),
      `Restore cleanly refused execution without --confirm: "${err.message}".`);
  }
  assert(restoreRefusalCaught, 'runRestore without confirm flag threw an expected error.');

  // -------------------------------------------------------------------------
  // 6. Restore validates target database and backup file
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Target Database & Backup File Validation ---');
  // System database rejection
  let postgresDbCaught = false;
  try {
    validateTargetDatabase({ database: 'postgres' });
  } catch (err) {
    postgresDbCaught = true;
    assert(err.message.includes('DILARANG') || err.message.includes('sistem'), 'Target "postgres" database was rejected.');
  }
  assert(postgresDbCaught, 'validateTargetDatabase prevented restore to system cluster database "postgres".');

  let template1Caught = false;
  try {
    validateTargetDatabase({ database: 'template1' });
  } catch (err) {
    template1Caught = true;
    assert(err.message.includes('DILARANG') || err.message.includes('sistem'), 'Target "template1" database was rejected.');
  }
  assert(template1Caught, 'validateTargetDatabase prevented restore to system database "template1".');

  assert(validateTargetDatabase({ database: 'rs_awal_bros_kb' }) === true, 'Standard application database name "rs_awal_bros_kb" is accepted.');

  // File existence & signature validation
  let missingFileCaught = false;
  try {
    validateBackupFile('non_existent_file_path_xyz.sql');
  } catch (err) {
    missingFileCaught = true;
  }
  assert(missingFileCaught, 'validateBackupFile rejects non-existent backup file.');

  const tempNonDumpFile = path.resolve(__dirname, '../temp_fake_backup_' + Date.now() + '.sql');
  fs.writeFileSync(tempNonDumpFile, 'HELLO THIS IS NOT A POSTGRESQL DUMP FILE');
  let invalidSignatureCaught = false;
  try {
    validateBackupFile(tempNonDumpFile);
  } catch (err) {
    invalidSignatureCaught = true;
    assert(err.message.includes('signature'), 'validateBackupFile detects missing PostgreSQL dump signature.');
  }
  assert(invalidSignatureCaught, 'validateBackupFile rejected non-pg_dump file content.');
  fs.unlinkSync(tempNonDumpFile);

  const tempValidDumpFile = path.resolve(__dirname, '../temp_valid_dump_' + Date.now() + '.sql');
  fs.writeFileSync(tempValidDumpFile, '-- PostgreSQL database dump\n-- Dumped by pg_dump version 15.0\nSELECT 1;');
  const validDumpRes = validateBackupFile(tempValidDumpFile);
  assert(validDumpRes.valid === true, 'validateBackupFile accepts valid PostgreSQL dump header.');
  fs.unlinkSync(tempValidDumpFile);

  // -------------------------------------------------------------------------
  // 7, 8, 9, 10. Safe SOP Seeding & Preservation
  // -------------------------------------------------------------------------
  console.log('\n--- 7, 8, 9, 10. Safe SOP Seeding, Edits Preservation & Force Mode ---');
  const memDb = newDb();
  memDb.public.registerFunction({
    name: 'gen_random_uuid',
    implementation: () => crypto.randomUUID(),
    impure: true,
  });
  memDb.public.registerEquivalentType({
    name: 'tsvector',
    equivalentTo: DataType.text,
  });

  const adapter = memDb.adapters.createPg();
  const testPool = new adapter.Pool();
  const memClient = await testPool.connect();

  try {
    // Run schema
    const upFile = path.resolve(__dirname, '../database/migrations/001_initial_schema.up.sql');
    const upSql = fs.readFileSync(upFile, 'utf8');
    const ddlWithoutTrigger = upSql.split('-- 8. Trigger function for Search Vector update')[0];
    await memClient.query(ddlWithoutTrigger);

    // Initial Seed
    const initialSeed = await seedSOPData(testPool);
    assert(initialSeed.guidesCount === 8, 'Initial seed created exactly 8 SOP guides.');
    assert(initialSeed.stepsCount === 24, 'Initial seed created exactly 24 baseline steps.');

    // 7. Admin modifies existing guide title and status
    const cacheGuideRes = await memClient.query("SELECT id, title FROM guides WHERE key_code = 'cache'");
    const cacheGuideId = cacheGuideRes.rows[0].id;
    await memClient.query(
      "UPDATE guides SET title = 'Pembersihan Cache Khusus Poli Bedah', status = 'DRAFT' WHERE id = $1",
      [cacheGuideId]
    );

    // 8. Admin adds a custom 4th step
    await memClient.query(
      "INSERT INTO guide_steps (guide_id, step_number, title, instruction) VALUES ($1, 4, 'Langkah Tambahan Khusus Tim IT', 'Instruksi khusus perawat OK')",
      [cacheGuideId]
    );

    // Run Safe Seed (Default Mode: force = false)
    console.log('  Testing Safe Seed execution (mode default without force)...');
    const safeSeedResult = await seedSOPData(testPool, { force: false });

    // Verify modifications preserved
    const afterSafeRes = await memClient.query("SELECT title, status FROM guides WHERE id = $1", [cacheGuideId]);
    assert(afterSafeRes.rows[0].title === 'Pembersihan Cache Khusus Poli Bedah',
      'Safe seed preserved administrator edited title ("Pembersihan Cache Khusus Poli Bedah").');
    assert(afterSafeRes.rows[0].status === 'DRAFT',
      'Safe seed preserved administrator edited status ("DRAFT").');

    const stepsAfterSafe = await memClient.query("SELECT count(*) as c FROM guide_steps WHERE guide_id = $1", [cacheGuideId]);
    assert(parseInt(stepsAfterSafe.rows[0].c, 10) === 4,
      'Safe seed preserved custom 4th step (step count remains 4).');

    // 9. Repeated safe seeding remains idempotent
    await seedSOPData(testPool, { force: false });
    const allGuidesRes = await memClient.query("SELECT count(*) as c FROM guides");
    assert(parseInt(allGuidesRes.rows[0].c, 10) === 8, 'Repeated safe seeding is idempotent: guide count remains 8.');

    // 10. Force behavior resets baseline records
    console.log('  Testing intentional force seed execution (--force)...');
    await seedSOPData(testPool, { force: true });
    const afterForceRes = await memClient.query("SELECT title, status FROM guides WHERE id = $1", [cacheGuideId]);
    const srcSOP = readSourceSOPData();
    assert(afterForceRes.rows[0].title === srcSOP.cache.title,
      `Force seed reset title back to baseline template ("${srcSOP.cache.title}").`);
    assert(afterForceRes.rows[0].status === 'PUBLISHED',
      'Force seed reset status back to PUBLISHED.');

    const stepsAfterForce = await memClient.query("SELECT count(*) as c FROM guide_steps WHERE guide_id = $1", [cacheGuideId]);
    assert(parseInt(stepsAfterForce.rows[0].c, 10) === 3,
      'Force seed reset steps count back to baseline 3 steps.');
  } finally {
    memClient.release();
    await testPool.end();
  }

  // -------------------------------------------------------------------------
  // 11. docker-entrypoint.sh does not use --force
  // -------------------------------------------------------------------------
  console.log('\n--- 11. Docker Entrypoint Safe Startup ---');
  const entrypointPath = path.resolve(__dirname, '../docker-entrypoint.sh');
  assert(fs.existsSync(entrypointPath), 'docker-entrypoint.sh exists.');
  const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
  assert(!entrypointContent.includes('seed-sop-data.js --force'), 'docker-entrypoint.sh does NOT include --force flag.');
  assert(entrypointContent.includes('node database/seed-sop-data.js'), 'docker-entrypoint.sh runs safe baseline seed.');

  // -------------------------------------------------------------------------
  // 12. JWT fallback is rejected in production
  // -------------------------------------------------------------------------
  console.log('\n--- 12. JWT Production Hardening ---');
  let rejectedInsecureSecret = false;
  try {
    validateJwtSecret('awal-bros-botania-prod-jwt-secret-min-32-chars', 'production');
  } catch (err) {
    rejectedInsecureSecret = true;
    assert(err.message.includes('not permitted in production') || err.message.includes('CRITICAL'),
      `Insecure secret rejected: "${err.message}".`);
  }
  assert(rejectedInsecureSecret, 'Known compose fallback secret was strictly rejected in production.');
  assert(INSECURE_SECRETS.includes('awal-bros-botania-prod-jwt-secret-min-32-chars'),
    'INSECURE_SECRETS explicitly includes "awal-bros-botania-prod-jwt-secret-min-32-chars".');

  let rejectedShortSecret = false;
  try {
    validateJwtSecret('short-secret-123', 'production');
  } catch (err) {
    rejectedShortSecret = true;
  }
  assert(rejectedShortSecret, 'Short secret (< 32 characters) was strictly rejected in production.');

  // Valid production secret passes
  const validProdSecret = 'my-super-secure-production-jwt-secret-with-plenty-of-characters-12345';
  assert(validateJwtSecret(validProdSecret, 'production') === validProdSecret,
    'Valid 32+ character production secret is accepted.');

  // -------------------------------------------------------------------------
  // 13. docker-compose no longer contains hardcoded JWT fallback
  // -------------------------------------------------------------------------
  console.log('\n--- 13. Docker Compose Secret Hardening ---');
  const composePath = path.resolve(__dirname, '../docker-compose.yml');
  assert(fs.existsSync(composePath), 'docker-compose.yml exists.');
  const composeContent = fs.readFileSync(composePath, 'utf8');
  assert(!composeContent.includes('awal-bros-botania-prod-jwt-secret-min-32-chars'),
    'docker-compose.yml no longer contains hardcoded fallback JWT secret.');
  assert(composeContent.includes('JWT_SECRET: ${JWT_SECRET}'),
    'docker-compose.yml correctly passes JWT_SECRET from environment.');

  // -------------------------------------------------------------------------
  // 14. PostgreSQL port binds to 127.0.0.1
  // -------------------------------------------------------------------------
  console.log('\n--- 14. PostgreSQL Localhost Port Binding ---');
  assert(composeContent.includes('127.0.0.1:${POSTGRES_PORT:-5432}:5432'),
    'docker-compose.yml binds PostgreSQL host port strictly to 127.0.0.1.');
  assert(!composeContent.includes('- "${POSTGRES_PORT:-5432}:5432"'),
    'docker-compose.yml does not expose unrestricted public/LAN host port.');

  // -------------------------------------------------------------------------
  // 15. Pool timeout configuration exists
  // -------------------------------------------------------------------------
  console.log('\n--- 15. PostgreSQL Connection Pool Hardening ---');
  assert(typeof poolConfig === 'object' && poolConfig !== null, 'server/config/database exports poolConfig.');
  assert(typeof poolConfig.max === 'number' && poolConfig.max >= 5, `poolConfig.max is configured (${poolConfig.max}).`);
  assert(typeof poolConfig.idleTimeoutMillis === 'number' && poolConfig.idleTimeoutMillis >= 1000,
    `poolConfig.idleTimeoutMillis is configured (${poolConfig.idleTimeoutMillis} ms).`);
  assert(typeof poolConfig.connectionTimeoutMillis === 'number' && poolConfig.connectionTimeoutMillis >= 1000,
    `poolConfig.connectionTimeoutMillis is configured (${poolConfig.connectionTimeoutMillis} ms).`);

  // -------------------------------------------------------------------------
  // 16. .env.example documents M12 settings
  // -------------------------------------------------------------------------
  console.log('\n--- 16. Environment Documentation (.env.example) ---');
  const envExamplePath = path.resolve(__dirname, '../.env.example');
  assert(fs.existsSync(envExamplePath), '.env.example exists.');
  const envContent = fs.readFileSync(envExamplePath, 'utf8');
  assert(envContent.includes('BACKUP_DIR'), '.env.example documents BACKUP_DIR.');
  assert(envContent.includes('BACKUP_RETENTION_DAYS'), '.env.example documents BACKUP_RETENTION_DAYS.');
  assert(envContent.includes('DB_POOL_MAX'), '.env.example documents DB_POOL_MAX.');
  assert(envContent.includes('DB_POOL_IDLE_TIMEOUT_MS'), '.env.example documents DB_POOL_IDLE_TIMEOUT_MS.');
  assert(envContent.includes('DB_POOL_CONNECTION_TIMEOUT_MS'), '.env.example documents DB_POOL_CONNECTION_TIMEOUT_MS.');
  assert(envContent.includes('Production: REQUIRED! Must be at least 32 characters'),
    '.env.example documents explicit production JWT_SECRET requirements.');

  // -------------------------------------------------------------------------
  // 17. RUNBOOK.md exists and contains required operational sections
  // -------------------------------------------------------------------------
  console.log('\n--- 17. RUNBOOK.md Operational Coverage (Sections A-Q) ---');
  const runbookPath = path.resolve(__dirname, '../RUNBOOK.md');
  assert(fs.existsSync(runbookPath), 'RUNBOOK.md exists.');
  const runbookContent = fs.readFileSync(runbookPath, 'utf8');

  const requiredSections = [
    'A. Initial Setup',
    'B. Native Startup',
    'C. Docker Startup',
    'D. Database Backup',
    'E. Backup Retention',
    'F. Restore Procedure',
    'G. Restore Verification',
    'H. Disaster Recovery Scenario',
    'I. Database Corruption Scenario',
    'J. Accidental Data Deletion Scenario',
    'K. JWT Secret Rotation',
    'L. PostgreSQL Connectivity Troubleshooting',
    'M. Application Health & Readiness Checks',
    'N. Backup Verification & Drill Procedure',
    'O. Important Warnings & Destructive Operations',
    'P. What is NOT Automatically Backed Up',
    'Q. Recommended Operational Backup Scheduling Approach',
  ];

  for (const sec of requiredSections) {
    assert(runbookContent.includes(sec), `RUNBOOK.md contains section "${sec}".`);
  }

  // -------------------------------------------------------------------------
  // 18. Tooling & Live Verification Diagnostic
  // -------------------------------------------------------------------------
  console.log('\n--- 18. PostgreSQL Client Tooling & Diagnostic Check ---');
  const pgDumpCheck = checkPgDumpTool();
  const psqlCheck = checkPsqlTool();

  console.log(`  [Diagnostic] pg_dump tool available: ${pgDumpCheck.available ? 'YES (' + pgDumpCheck.version + ')' : 'NO (' + pgDumpCheck.error + ')'}`);
  console.log(`  [Diagnostic] psql tool available   : ${psqlCheck.available ? 'YES (' + psqlCheck.version + ')' : 'NO (' + psqlCheck.error + ')'}`);

  assert(typeof pgDumpCheck.available === 'boolean', 'checkPgDumpTool returns structured availability object.');
  assert(typeof psqlCheck.available === 'boolean', 'checkPsqlTool returns structured availability object.');

  // Live Drill: Test real pg_dump & psql execution if PostgreSQL Docker container is active
  const dockerContainerCheck = spawnSync('docker', ['exec', 'awal-bros-postgres-test', 'pg_dump', '--version'], { encoding: 'utf8' });
  if (dockerContainerCheck.status === 0) {
    console.log('  [Live Drill] Active container "awal-bros-postgres-test" detected. Executing live backup & restore drill...');
    const drillDbName = 'rs_awal_bros_m12_drill_' + Date.now();
    const drillBackupDir = path.resolve(__dirname, '../backups');
    if (!fs.existsSync(drillBackupDir)) fs.mkdirSync(drillBackupDir, { recursive: true });
    const drillBackupFile = path.join(drillBackupDir, `rs_awal_bros_kb_backup_drill_${Date.now()}.sql`);

    try {
      // 1. Create temporary database
      spawnSync('docker', ['exec', 'awal-bros-postgres-test', 'psql', '-U', 'postgres', '-c', `CREATE DATABASE ${drillDbName};`]);

      // 2. Insert test table and data
      spawnSync('docker', ['exec', 'awal-bros-postgres-test', 'psql', '-U', 'postgres', '-d', drillDbName, '-c',
        "CREATE TABLE disaster_drill (id serial primary key, message text); INSERT INTO disaster_drill (message) VALUES ('DRILL_VERIFIED_OK');"]);

      // 3. Perform live pg_dump
      const dumpRes = spawnSync('docker', ['exec', 'awal-bros-postgres-test', 'pg_dump', '-U', 'postgres', '-d', drillDbName, '--clean', '--if-exists'], { encoding: 'utf8' });
      assert(dumpRes.status === 0, 'Live container pg_dump completed with exit code 0.');
      fs.writeFileSync(drillBackupFile, dumpRes.stdout);

      // 4. Validate backup file using project validator
      const validation = validateBackupFile(drillBackupFile);
      assert(validation.valid === true, 'Generated live backup file passed validateBackupFile().');

      // 5. Drop table to simulate disaster
      spawnSync('docker', ['exec', 'awal-bros-postgres-test', 'psql', '-U', 'postgres', '-d', drillDbName, '-c', 'DROP TABLE disaster_drill;']);

      // 6. Restore from backup
      const restoreRes = spawnSync('docker', ['exec', '-i', 'awal-bros-postgres-test', 'psql', '-U', 'postgres', '-d', drillDbName, '-v', 'ON_ERROR_STOP=1'], {
        input: fs.readFileSync(drillBackupFile),
        encoding: 'utf8',
      });
      assert(restoreRes.status === 0, 'Live container psql restore completed with exit code 0.');

      // 7. Verify restored row
      const selectRes = spawnSync('docker', ['exec', 'awal-bros-postgres-test', 'psql', '-U', 'postgres', '-d', drillDbName, '-c', 'SELECT message FROM disaster_drill;'], { encoding: 'utf8' });
      assert(selectRes.stdout.includes('DRILL_VERIFIED_OK'), 'Restored row data verified successfully in live database.');
      console.log('  [Live Drill] Live backup and restore drill PASSED 100%!');
    } finally {
      // Clean up drill database and dump file
      spawnSync('docker', ['exec', 'awal-bros-postgres-test', 'psql', '-U', 'postgres', '-c', `DROP DATABASE IF EXISTS ${drillDbName};`]);
      if (fs.existsSync(drillBackupFile)) {
        fs.unlinkSync(drillBackupFile);
      }
    }
  } else {
    console.log('  [Live Drill] Container "awal-bros-postgres-test" not active; static & simulated validation completed.');
  }

  console.log('\n================================================================');
  console.log(` ALL M12 TESTS PASSED SUCCESSFULLY (${passedTests}/${totalTests} assertions)!`);
  console.log('================================================================\n');
}

// CLI Execution if run directly: node scripts/test-disaster-recovery-m12.js
if (require.main === module) {
  runM12TestSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\nM12 Test Suite Failed:', err);
      process.exit(1);
    });
}

module.exports = {
  runM12TestSuite,
};
