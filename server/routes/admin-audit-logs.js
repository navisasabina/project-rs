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
const { requireAuth } = require('../middleware/auth');

// Helper to sanitize any potential sensitive fields in changes JSON
function sanitizeChanges(changes) {
  if (!changes || typeof changes !== 'object') {
    return changes;
  }

  const sensitiveKeys = ['password', 'password_hash', 'token', 'secret', 'auth_token', 'authorization', 'cookie'];
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

/**
 * GET /api/v1/admin/audit-logs
 * Protected: Authenticated IT staff
 * Query params: ?limit=50&offset=0&action=...&entity=...&search=...
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { action, entity, search } = req.query;

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

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
