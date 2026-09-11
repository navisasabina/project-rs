/**
 * Database Backup Script: database/backup.js
 * 
 * Generates full, timestamped PostgreSQL backups for RS Awal Bros Hardware Guidebook.
 * Adheres strictly to M12 disaster recovery and zero-external-dependency requirements.
 * 
 * Default backup dir: backups/ (configured via BACKUP_DIR)
 * Retention: 7 days (configured via BACKUP_RETENTION_DAYS)
 * Backup format: Standard PostgreSQL plain SQL with transactional DROP/CREATE statements.
 */

'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Standard backup file pattern strictly recognized for retention management
const BACKUP_FILE_PREFIX = 'rs_awal_bros_kb_backup_';
const BACKUP_FILE_REGEX = /^rs_awal_bros_kb_backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql$/;

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
      console.warn('[Backup] Warning: Unable to parse DATABASE_URL as URL. Falling back to discrete env vars.');
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
 * Validates retention days configuration
 */
function parseRetentionDays(rawDays) {
  const parsed = parseInt(rawDays !== undefined ? rawDays : process.env.BACKUP_RETENTION_DAYS, 10);
  if (isNaN(parsed) || parsed < 0) {
    console.warn(`[Backup] Peringatan: Nilai BACKUP_RETENTION_DAYS tidak valid (${rawDays}). Menggunakan default 7 hari.`);
    return 7;
  }
  return parsed;
}

/**
 * Generates a timestamped filename safe for Windows and POSIX filesystems
 */
function generateBackupFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());

  return `${BACKUP_FILE_PREFIX}${YYYY}-${MM}-${DD}_${HH}-${mm}-${ss}.sql`;
}

/**
 * Checks whether pg_dump utility is available on the system
 */
function checkPgDumpTool(customExecutable) {
  const exe = customExecutable || process.env.PG_DUMP_PATH || 'pg_dump';
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
 * Prunes project backup files older than retentionDays.
 * Strictly avoids deleting unrelated files or non-project files.
 */
function pruneOldBackups(backupDir, retentionDays) {
  const retention = parseRetentionDays(retentionDays);
  const result = { pruned: [], kept: [], skipped: [] };

  if (!fs.existsSync(backupDir)) {
    return result;
  }

  const now = Date.now();
  const maxAgeMs = retention * 24 * 60 * 60 * 1000;
  const entries = fs.readdirSync(backupDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    // Safety check 1: Only operate on files matching the project backup pattern
    if (!BACKUP_FILE_REGEX.test(entry.name)) {
      result.skipped.push(entry.name);
      continue;
    }

    const filePath = path.join(backupDir, entry.name);
    try {
      const stats = fs.statSync(filePath);
      const ageMs = now - stats.mtimeMs;

      if (ageMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        result.pruned.push({ file: entry.name, ageDays: (ageMs / (24 * 60 * 60 * 1000)).toFixed(1) });
        console.log(`[Backup Retention] Menghapus backup usang (> ${retention} hari): ${entry.name}`);
      } else {
        result.kept.push(entry.name);
      }
    } catch (err) {
      console.warn(`[Backup Retention] Gagal memeriksa berkas ${entry.name}:`, err.message);
    }
  }

  return result;
}

/**
 * Executes standard PostgreSQL database backup
 */
async function runBackup(options = {}) {
  const dbConfig = options.dbConfig || getDbConfig();
  const backupDir = path.resolve(process.cwd(), options.backupDir || process.env.BACKUP_DIR || 'backups');
  const retentionDays = parseRetentionDays(options.retentionDays);
  const pgDumpExe = options.pgDumpExecutable || process.env.PG_DUMP_PATH || 'pg_dump';

  console.log('====================================================');
  console.log(' RS AWAL BROS - SISTEM BACKUP DATABASE POSTGRESQL');
  console.log('====================================================');
  console.log(`[Backup] Target Database : ${dbConfig.database} pada ${dbConfig.host}:${dbConfig.port}`);
  console.log(`[Backup] Target User     : ${dbConfig.user}`);
  console.log(`[Backup] Direktori       : ${backupDir}`);
  console.log(`[Backup] Retensi         : ${retentionDays} hari`);

  // Ensure backup directory exists
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log(`[Backup] Membuat direktori backup: ${backupDir}`);
  }

  // Check tooling availability
  const toolCheck = checkPgDumpTool(pgDumpExe);
  if (!toolCheck.available) {
    const errorMsg = `PostgreSQL backup utility 'pg_dump' tidak ditemukan dalam PATH atau PG_DUMP_PATH (${toolCheck.error}). ` +
      `Pastikan postgresql-client terpasang pada host atau gunakan PG_DUMP_PATH.`;
    console.error(`[Backup] FATAL: ${errorMsg}`);
    throw new Error(errorMsg);
  }
  console.log(`[Backup] Tooling         : ${toolCheck.version}`);

  const filename = options.filename || generateBackupFilename();
  const targetFile = path.join(backupDir, filename);

  console.log(`[Backup] Menulis backup ke : ${filename}`);

  const args = [
    '-h', dbConfig.host,
    '-p', String(dbConfig.port),
    '-U', dbConfig.user,
    '-d', dbConfig.database,
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '-f', targetFile,
  ];

  // Securely pass credentials via environment variable only
  const env = {
    ...process.env,
    PGPASSWORD: dbConfig.password,
  };

  const dumpResult = spawnSync(toolCheck.executable, args, {
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 120000, // 2 minutes max
  });

  if (dumpResult.error || dumpResult.status !== 0) {
    // Clean up partial file on failure to prevent corrupted restoration targets
    if (fs.existsSync(targetFile)) {
      try { fs.unlinkSync(targetFile); } catch (_) {}
    }
    const sanitizedError = (dumpResult.stderr || dumpResult.error?.message || 'Unknown pg_dump error')
      .replace(new RegExp(dbConfig.password, 'g'), '********');
    console.error(`[Backup] ERROR: Eksekusi pg_dump gagal (status ${dumpResult.status}):\n${sanitizedError}`);
    throw new Error(`pg_dump failed with exit code ${dumpResult.status}: ${sanitizedError}`);
  }

  if (!fs.existsSync(targetFile)) {
    throw new Error(`Berkas backup tidak ditemukan setelah eksekusi pg_dump: ${targetFile}`);
  }

  const fileStats = fs.statSync(targetFile);
  if (fileStats.size === 0) {
    fs.unlinkSync(targetFile);
    throw new Error('Berkas backup yang dihasilkan kosong (0 byte).');
  }

  const sizeKb = (fileStats.size / 1024).toFixed(2);
  console.log(`[Backup] SUKSES! Ukuran berkas: ${sizeKb} KB`);
  console.log(`[Backup] Path lengkap: ${targetFile}`);

  // Prune only after successful backup
  const retentionResult = pruneOldBackups(backupDir, retentionDays);
  console.log(`[Backup Retention] Selesai. Disimpan: ${retentionResult.kept.length + 1} berkas, Dihapus: ${retentionResult.pruned.length} berkas.`);

  return {
    success: true,
    file: targetFile,
    filename,
    sizeBytes: fileStats.size,
    sizeKb,
    timestamp: new Date().toISOString(),
    retention: retentionResult,
  };
}

// CLI Execution if run directly: node database/backup.js
if (require.main === module) {
  runBackup()
    .then(() => {
      console.log('[Backup] Proses backup selesai dengan status sukses (exit code 0).');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Backup] Proses backup gagal.');
      process.exit(1);
    });
}

module.exports = {
  runBackup,
  pruneOldBackups,
  getDbConfig,
  parseRetentionDays,
  generateBackupFilename,
  checkPgDumpTool,
  BACKUP_FILE_PREFIX,
  BACKUP_FILE_REGEX,
};
