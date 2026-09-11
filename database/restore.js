/**
 * Database Restore Script: database/restore.js
 * 
 * Safely restores a PostgreSQL database backup for RS Awal Bros Hardware Guidebook.
 * Adheres strictly to M12 disaster recovery safety requirements:
 * - Requires explicit confirmation flag (--confirm)
 * - Validates backup file authenticity and signature
 * - Validates target database to prevent destructive actions on system/wrong databases
 * - Verifies row integrity of core application tables after restoration
 * - Never prints credentials to logs
 */

'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');

// Disallowed system databases to prevent accidental destruction
const SYSTEM_DATABASES = new Set(['postgres', 'template0', 'template1', 'information_schema']);

/**
 * Parses and returns database connection configuration without exposing secrets
 */
function getDbConfig() {
  if (process.env.DATABASE_URL) {
    try {
      const parsed = new URL(process.env.DATABASE_URL);
      return {
        host: parsed.hostname || 'localhost',
        port: parseInt(parsed.port, 10) || 5432,
        database: parsed.pathname ? parsed.pathname.replace(/^\//, '') : 'rs_awal_bros_kb',
        user: decodeURIComponent(parsed.username || 'postgres'),
        password: decodeURIComponent(parsed.password || 'postgres'),
      };
    } catch (err) {
      console.warn('[Restore] Warning: Unable to parse DATABASE_URL as URL. Falling back to discrete env vars.');
    }
  }

  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
    database: process.env.POSTGRES_DB || 'rs_awal_bros_kb',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
  };
}

/**
 * Validates that the target database is not a protected system database
 */
function validateTargetDatabase(dbConfig) {
  if (!dbConfig || !dbConfig.database) {
    throw new Error('Konfigurasi database target tidak valid atau nama database kosong.');
  }

  const dbLower = dbConfig.database.toLowerCase().trim();
  if (SYSTEM_DATABASES.has(dbLower)) {
    throw new Error(`DILARANG: Target database '${dbConfig.database}' merupakan database sistem cluster PostgreSQL. Operasi restore dibatalkan demi keamanan.`);
  }

  return true;
}

/**
 * Validates the authenticity and structure of the backup file before executing restore
 */
function validateBackupFile(filePath) {
  if (!filePath) {
    throw new Error('Path berkas backup belum ditentukan.');
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Berkas backup tidak ditemukan pada lokasi: ${resolvedPath}`);
  }

  const stats = fs.statSync(resolvedPath);
  if (!stats.isFile()) {
    throw new Error(`Path bukan merupakan berkas reguler: ${resolvedPath}`);
  }

  if (stats.size === 0) {
    throw new Error(`Berkas backup kosong (0 byte): ${resolvedPath}`);
  }

  // Read the first 4KB to verify PostgreSQL plain SQL dump headers
  const fd = fs.openSync(resolvedPath, 'r');
  const buffer = Buffer.alloc(Math.min(4096, stats.size));
  fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);

  const headerContent = buffer.toString('utf8');
  const hasPgHeader = headerContent.includes('PostgreSQL database dump') ||
    headerContent.includes('Dumped by pg_dump') ||
    headerContent.includes('Dumped from database version') ||
    headerContent.includes('-- PostgreSQL');

  if (!hasPgHeader) {
    throw new Error(`Berkas tidak memiliki signature dump PostgreSQL yang sah: ${resolvedPath}`);
  }

  return {
    valid: true,
    resolvedPath,
    sizeBytes: stats.size,
    sizeKb: (stats.size / 1024).toFixed(2),
  };
}

/**
 * Checks whether psql utility is available on the system
 */
function checkPsqlTool(customExecutable) {
  const exe = customExecutable || process.env.PSQL_PATH || 'psql';
  try {
    const result = spawnSync(exe, ['--version'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 5000,
    });
    if (result.error || result.status !== 0) {
      return { available: false, executable: exe, error: result.error ? result.error.message : 'Non-zero exit status' };
    }
    return { available: true, executable: exe, version: (result.stdout || '').trim() };
  } catch (err) {
    return { available: false, executable: exe, error: err.message };
  }
}

/**
 * Verifies core application tables and data integrity after restoration
 */
async function verifyRestoredData(dbConfig) {
  const tempPool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    connectionTimeoutMillis: 5000,
  });

  const client = await tempPool.connect();
  const summary = {};

  try {
    const tables = ['schema_migrations', 'categories', 'guides', 'guide_steps', 'users', 'audit_logs'];

    for (const table of tables) {
      try {
        const res = await client.query(`SELECT count(*) AS total FROM ${table}`);
        summary[table] = parseInt(res.rows[0].total, 10);
      } catch (tableErr) {
        summary[table] = null; // Table may not exist yet if backup was an older partial state
      }
    }

    console.log('[Restore Verification] Hasil verifikasi integritas database:');
    console.log(`  - schema_migrations : ${summary.schema_migrations !== null ? summary.schema_migrations + ' migrasi' : 'Tabel tidak ditemukan'}`);
    console.log(`  - categories        : ${summary.categories !== null ? summary.categories + ' baris' : 'Tabel tidak ditemukan'}`);
    console.log(`  - guides            : ${summary.guides !== null ? summary.guides + ' panduan' : 'Tabel tidak ditemukan'}`);
    console.log(`  - guide_steps       : ${summary.guide_steps !== null ? summary.guide_steps + ' langkah' : 'Tabel tidak ditemukan'}`);
    console.log(`  - users             : ${summary.users !== null ? summary.users + ' pengguna' : 'Tabel tidak ditemukan'}`);
    console.log(`  - audit_logs        : ${summary.audit_logs !== null ? summary.audit_logs + ' riwayat log' : 'Tabel tidak ditemukan'}`);

    // Core validation: guides, categories, and schema_migrations must be present
    if (summary.guides === null || summary.categories === null || summary.schema_migrations === null) {
      throw new Error('Verifikasi restore gagal: Satu atau lebih tabel inti aplikasi tidak ditemukan.');
    }

    return summary;
  } finally {
    client.release();
    await tempPool.end().catch(() => {});
  }
}

/**
 * Runs the database restore procedure safely
 */
async function runRestore(backupFilePath, options = {}) {
  const isConfirmed = options.confirm === true ||
    process.argv.includes('--confirm') ||
    process.env.CONFIRM_RESTORE === 'true';

  console.log('====================================================');
  console.log(' RS AWAL BROS - SISTEM RESTORE DATABASE POSTGRESQL');
  console.log('====================================================');

  // Strict Safety Guard 1: Must provide explicit --confirm
  if (!isConfirmed) {
    console.error('[Restore] DANGER: Operasi restore akan menimpa seluruh skema dan data pada database target!');
    console.error('[Restore] Eksekusi DITOLAK karena parameter konfirmasi belum diberikan.');
    console.error('[Restore] Jalankan perintah dengan menambahkan flag --confirm secara eksplisit:');
    console.error(`[Restore]   node database/restore.js "${backupFilePath || '<path-ke-backup.sql>'}" --confirm\n`);
    throw new Error('Restore confirmation required. Pass --confirm or set CONFIRM_RESTORE=true.');
  }

  // Safety Guard 2: Validate backup file existence and signature
  const fileValidation = validateBackupFile(backupFilePath);
  console.log(`[Restore] Berkas Backup  : ${fileValidation.resolvedPath} (${fileValidation.sizeKb} KB) [VALID]`);

  // Safety Guard 3: Validate target database configuration
  const dbConfig = options.dbConfig || getDbConfig();
  validateTargetDatabase(dbConfig);

  console.log(`[Restore] Target Database: ${dbConfig.database} pada ${dbConfig.host}:${dbConfig.port}`);
  console.log(`[Restore] Target User    : ${dbConfig.user}`);

  // Safety Guard 4: Check psql utility availability
  const psqlExe = options.psqlExecutable || process.env.PSQL_PATH || 'psql';
  const toolCheck = checkPsqlTool(psqlExe);
  if (!toolCheck.available) {
    const errorMsg = `PostgreSQL client utility 'psql' tidak ditemukan dalam PATH atau PSQL_PATH (${toolCheck.error}). ` +
      `Pastikan postgresql-client terpasang pada sistem atau gunakan PSQL_PATH.`;
    console.error(`[Restore] FATAL: ${errorMsg}`);
    throw new Error(errorMsg);
  }
  console.log(`[Restore] Tooling        : ${toolCheck.version}`);

  console.log('[Restore] Menjalankan pemulihan database melalui psql...');

  const args = [
    '-h', dbConfig.host,
    '-p', String(dbConfig.port),
    '-U', dbConfig.user,
    '-d', dbConfig.database,
    '-v', 'ON_ERROR_STOP=1',
    '-f', fileValidation.resolvedPath,
  ];

  const env = {
    ...process.env,
    PGPASSWORD: dbConfig.password,
  };

  const restoreResult = spawnSync(toolCheck.executable, args, {
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 300000, // 5 minutes max
  });

  if (restoreResult.error || restoreResult.status !== 0) {
    const sanitizedError = (restoreResult.stderr || restoreResult.error?.message || 'Unknown psql restore error')
      .replace(new RegExp(dbConfig.password, 'g'), '********');
    console.error(`[Restore] ERROR: Eksekusi psql restore gagal (status ${restoreResult.status}):\n${sanitizedError}`);
    throw new Error(`psql restore failed with exit code ${restoreResult.status}: ${sanitizedError}`);
  }

  console.log('[Restore] Eksekusi script SQL selesai. Melakukan verifikasi integritas data...');

  // Verification
  const verification = await verifyRestoredData(dbConfig);

  console.log('====================================================');
  console.log('[Restore] PEMULIHAN BERHASIL DAN TERVERIFIKASI!');
  console.log('====================================================');

  return {
    success: true,
    file: fileValidation.resolvedPath,
    target: {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
    },
    verification,
  };
}

// CLI Execution if run directly: node database/restore.js <path> --confirm
if (require.main === module) {
  const targetFile = process.argv.find((arg) => !arg.startsWith('--') && !arg.endsWith('restore.js') && !arg.endsWith('restore'));

  if (!targetFile) {
    console.error('[Restore] Penggunaan:');
    console.error('  node database/restore.js <path-ke-file-backup.sql> --confirm');
    process.exit(1);
  }

  runRestore(targetFile)
    .then(() => {
      console.log('[Restore] Selesai dengan status sukses (exit code 0).');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Restore] Gagal:', err.message);
      process.exit(1);
    });
}

module.exports = {
  runRestore,
  validateBackupFile,
  validateTargetDatabase,
  verifyRestoredData,
  checkPsqlTool,
  getDbConfig,
};
