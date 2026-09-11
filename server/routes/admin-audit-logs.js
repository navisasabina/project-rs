/**
 * Admin Audit Trail Routes — RS Awal Bros IT Knowledge Base
 * 
 * Implements:
 * - GET /api/v1/admin/audit-logs (Read-only retrieval of administrative audit events)
 * 
 * Security & Design:
 * - Requires active authentication (requireAuth)
 * - Read-only: NO update, NO delete, NO clear endpoints
 * - Never returns password_hash, passwords, JWTs, secrets, or credentials
 * - Joins safe user information (username, full_name, role) for actor details
 * - Strictly parameterized SQL queries
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth, requireRoles } = require('../middleware/auth');

// Helper to sanitize any potential sensitive fields in changes JSON
function sanitizeChanges(changes) {
  if (!changes || typeof changes !== 'object') {
    return changes;
  }

  const sensitiveKeys = [
    'password',
    'password_hash',
    'token',
    'secret',
    'auth_token',
    'authorization',
    'cookie',
    'apikey',
    'api_key',
    'gemini',
    'jwt',
  ];
  const sanitized = Array.isArray(changes) ? [] : {};

  for (const [key, val] of Object.entries(changes)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      continue; // Exclude sensitive keys entirely
    }
    if (val && typeof val === 'object') {
      sanitized[key] = sanitizeChanges(val);
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized;
}

// RFC 4180 compliant CSV field escaping
function escapeCsvValue(val) {
  if (val === null || val === undefined) {
    return '';
  }
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatCsvRow(fields) {
  return fields.map(escapeCsvValue).join(',') + '\r\n';
}

// Date parser with inclusive bounds
function parseDateFilter(dateStr, isEndOfDay = false) {
  if (!dateStr || typeof dateStr !== 'string' || !dateStr.trim()) {
    return null;
  }
  const trimmed = dateStr.trim();
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    if (isEndOfDay) {
      d = new Date(`${trimmed}T23:59:59.999Z`);
    } else {
      d = new Date(`${trimmed}T00:00:00.000Z`);
    }
  } else {
    d = new Date(trimmed);
  }

  if (isNaN(d.getTime())) {
    const err = new Error('Format tanggal filter tidak valid (gunakan format YYYY-MM-DD atau ISO 8601).');
    err.code = 'INVALID_DATE_FORMAT';
    err.statusCode = 400;
    throw err;
  }
  return d;
}

// Shared audit log filter builder
function buildAuditFilter(query) {
  const { action, entity, search, from, to } = query;
  let whereClause = 'WHERE 1=1';
  const queryParams = [];

  if (action && typeof action === 'string' && action !== 'ALL') {
    queryParams.push(action);
    whereClause += ` AND a.action = $${queryParams.length}`;
  }

  if (entity && typeof entity === 'string' && entity !== 'ALL') {
    queryParams.push(entity);
    whereClause += ` AND a.entity_name = $${queryParams.length}`;
  }

  if (search && typeof search === 'string' && search.trim().length > 0) {
    queryParams.push(`%${search.trim().toLowerCase()}%`);
    whereClause += ` AND (
      LOWER(a.action) LIKE $${queryParams.length}
      OR LOWER(a.entity_name) LIKE $${queryParams.length}
      OR LOWER(COALESCE(u.username, '')) LIKE $${queryParams.length}
      OR LOWER(COALESCE(u.full_name, '')) LIKE $${queryParams.length}
    )`;
  }

  const fromDate = parseDateFilter(from, false);
  const toDate = parseDateFilter(to, true);

  if (fromDate && toDate && fromDate > toDate) {
    const err = new Error('Tanggal awal (from) tidak boleh lebih besar dari tanggal akhir (to).');
    err.code = 'INVALID_DATE_RANGE';
    err.statusCode = 400;
    throw err;
  }

  if (fromDate) {
    queryParams.push(fromDate.toISOString());
    whereClause += ` AND a.created_at >= $${queryParams.length}`;
  }

  if (toDate) {
    queryParams.push(toDate.toISOString());
    whereClause += ` AND a.created_at <= $${queryParams.length}`;
  }

  return { whereClause, queryParams, fromDate, toDate };
}

/**
 * GET /api/v1/admin/audit-logs/export
 * Protected: ADMIN, IT_MANAGER
 * Query params: ?format=csv|json&action=...&entity=...&from=...&to=...&search=...
 */
router.get('/export', requireAuth, requireRoles('ADMIN', 'IT_MANAGER'), async (req, res) => {
  try {
    const format = (req.query.format || 'csv').toLowerCase().trim();
    if (format !== 'csv' && format !== 'json') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_EXPORT_FORMAT',
          message: 'Format ekspor tidak didukung. Gunakan format \'csv\' atau \'json\'.',
        },
      });
    }

    const { whereClause, queryParams, fromDate, toDate } = buildAuditFilter(req.query);

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `audit_logs_rs_awal_bros_${timestamp}.${format}`;

    const BATCH_SIZE = 500;
    let offset = 0;
    let hasMore = true;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      // Write CSV Header row immediately
      const CSV_HEADERS = [
        'Timestamp (WIB/ISO)',
        'Action',
        'Entity Name',
        'Entity ID',
        'Actor Username',
        'Actor Full Name',
        'Actor Role',
        'IP Address',
        'User Agent',
        'Sanitized Changes JSON',
      ];
      res.write(formatCsvRow(CSV_HEADERS));

      while (hasMore) {
        const batchQueryParams = [...queryParams, BATCH_SIZE, offset];
        const dataSql = `
          SELECT
            a.id,
            a.user_id,
            a.action,
            a.entity_name,
            a.entity_id,
            a.changes,
            a.ip_address,
            a.user_agent,
            a.created_at,
            u.username AS actor_username,
            u.full_name AS actor_full_name,
            u.role AS actor_role
          FROM audit_logs a
          LEFT JOIN users u ON a.user_id = u.id
          ${whereClause}
          ORDER BY a.created_at DESC
          LIMIT $${batchQueryParams.length - 1} OFFSET $${batchQueryParams.length}
        `;

        const result = await db.query(dataSql, batchQueryParams);
        if (result.rows.length === 0) {
          break;
        }

        for (const row of result.rows) {
          const actorUsername = row.user_id
            ? (row.actor_username || 'unknown')
            : (row.changes && row.changes.username ? String(row.changes.username) : 'Sistem / Anonim');
          const actorFullName = row.user_id
            ? (row.actor_full_name || 'Staf IT')
            : 'Pengguna / Tamu';
          const actorRole = row.user_id
            ? (row.actor_role || 'IT_SUPPORT')
            : 'GUEST';

          const sanitizedChanges = sanitizeChanges(row.changes);
          const timestampStr = row.created_at instanceof Date
            ? row.created_at.toISOString()
            : new Date(row.created_at).toISOString();

          const csvRow = [
            timestampStr,
            row.action || '',
            row.entity_name || '',
            row.entity_id || '',
            actorUsername,
            actorFullName,
            actorRole,
            row.ip_address || '',
            row.user_agent || '',
            JSON.stringify(sanitizedChanges || {}),
          ];

          res.write(formatCsvRow(csvRow));
        }

        offset += result.rows.length;
        if (result.rows.length < BATCH_SIZE) {
          hasMore = false;
        }
      }

      return res.end();
    } else {
      // JSON format
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const safeFilters = {
        action: req.query.action || 'ALL',
        entity: req.query.entity || 'ALL',
        search: req.query.search || null,
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate ? toDate.toISOString() : null,
      };

      res.write('{"success":true,"meta":{"exported_at":"' + now.toISOString() + '","filters":' + JSON.stringify(safeFilters) + '},"data":[\n');

      let isFirstRow = true;

      while (hasMore) {
        const batchQueryParams = [...queryParams, BATCH_SIZE, offset];
        const dataSql = `
          SELECT
            a.id,
            a.user_id,
            a.action,
            a.entity_name,
            a.entity_id,
            a.changes,
            a.ip_address,
            a.user_agent,
            a.created_at,
            u.username AS actor_username,
            u.full_name AS actor_full_name,
            u.role AS actor_role
          FROM audit_logs a
          LEFT JOIN users u ON a.user_id = u.id
          ${whereClause}
          ORDER BY a.created_at DESC
          LIMIT $${batchQueryParams.length - 1} OFFSET $${batchQueryParams.length}
        `;

        const result = await db.query(dataSql, batchQueryParams);
        if (result.rows.length === 0) {
          break;
        }

        for (const row of result.rows) {
          let actor;
          if (row.user_id) {
            actor = {
              id: row.user_id,
              username: row.actor_username || 'unknown',
              full_name: row.actor_full_name || 'Staf IT',
              role: row.actor_role || 'IT_SUPPORT',
            };
          } else {
            const fallbackUsername = (row.changes && row.changes.username) ? String(row.changes.username) : 'Sistem / Anonim';
            actor = {
              id: null,
              username: fallbackUsername,
              full_name: 'Pengguna / Tamu',
              role: 'GUEST',
            };
          }

          const record = {
            id: row.id,
            timestamp: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
            action: row.action,
            entity_name: row.entity_name,
            entity_id: row.entity_id,
            actor,
            ip_address: row.ip_address,
            user_agent: row.user_agent,
            changes: sanitizeChanges(row.changes),
          };

          const prefix = isFirstRow ? '' : ',\n';
          res.write(prefix + JSON.stringify(record));
          isFirstRow = false;
        }

        offset += result.rows.length;
        if (result.rows.length < BATCH_SIZE) {
          hasMore = false;
        }
      }

      res.write('\n]}');
      return res.end();
    }
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        error: {
          code: err.code || 'VALIDATION_ERROR',
          message: err.message,
        },
      });
    }

    console.error('[Admin Audit Logs Error - GET /export]:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Terjadi kesalahan sistem saat mengekspor log audit.',
        },
      });
    } else {
      res.destroy(err);
    }
  }
});

/**
 * GET /api/v1/admin/audit-logs
 * Protected: Authenticated IT staff
 * Query params: ?limit=50&offset=0&action=...&entity=...&search=...&from=...&to=...
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { whereClause, queryParams } = buildAuditFilter(req.query);

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    // Count total matching records
    const countSql = `
      SELECT COUNT(*) AS total
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ${whereClause}
    `;
    const countResult = await db.query(countSql, queryParams);
    const totalCount = parseInt(countResult.rows[0].total, 10) || 0;

    // Fetch records with actor join
    const dataQueryParams = [...queryParams, limit, offset];
    const dataSql = `
      SELECT 
        a.id,
        a.user_id,
        a.action,
        a.entity_name,
        a.entity_id,
        a.changes,
        a.ip_address,
        a.user_agent,
        a.created_at,
        u.username AS actor_username,
        u.full_name AS actor_full_name,
        u.role AS actor_role
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${dataQueryParams.length - 1} OFFSET $${dataQueryParams.length}
    `;

    const result = await db.query(dataSql, dataQueryParams);

    const formattedRows = result.rows.map((row) => {
      let actor = null;
      if (row.user_id) {
        actor = {
          id: row.user_id,
          username: row.actor_username || 'unknown',
          full_name: row.actor_full_name || 'Staf IT',
          role: row.actor_role || 'IT_SUPPORT',
        };
      } else {
        // For unauthenticated events (like failed logins), extract safe identifier from changes if available
        const fallbackUsername = (row.changes && row.changes.username) ? String(row.changes.username) : 'Sistem / Anonim';
        actor = {
          id: null,
          username: fallbackUsername,
          full_name: 'Pengguna / Tamu',
          role: 'GUEST',
        };
      }

      return {
        id: row.id,
        action: row.action,
        entity_name: row.entity_name,
        entity_id: row.entity_id,
        changes: sanitizeChanges(row.changes),
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        created_at: row.created_at,
        actor,
      };
    });

    return res.status(200).json({
      success: true,
      data: formattedRows,
      meta: {
        total: totalCount,
        limit,
        offset,
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        error: {
          code: err.code || 'VALIDATION_ERROR',
          message: err.message,
        },
      });
    }

    console.error('[Admin Audit Logs Error - GET /]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat mengambil riwayat log audit.',
      },
    });
  }
});

module.exports = router;
