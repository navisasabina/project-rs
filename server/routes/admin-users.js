/**
 * Admin User Management & Account Provisioning Routes
 * 
 * Implements:
 * - POST  /api/v1/admin/users             (Create new internal user with role assignment security)
 * - PATCH /api/v1/admin/users/:id/status   (Activate/deactivate account lifecycle)
 * 
 * Security:
 * - No public registration
 * - Requires authentication (requireAuth)
 * - Restricts IT_SUPPORT from provisioning (requireRoles('ADMIN', 'IT_MANAGER'))
 * - Enforces role hierarchy (IT_MANAGER cannot create ADMIN or IT_MANAGER)
 * - Password hashing with bcrypt
 * - Never returns password_hash
 * - Records audit logs
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth, requireRoles, canProvisionRole } = require('../middleware/auth');
const { hashPassword, recordAuditLog } = require('../services/auth');

// Username regex validation: 3-50 chars, alphanumeric with dots, underscores, hyphens
const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,50}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ROLES = ['ADMIN', 'IT_MANAGER', 'IT_SUPPORT'];

/**
 * POST /api/v1/admin/users
 * Protected: ADMIN and IT_MANAGER only
 * Body: { full_name, username, email, password, role }
 */
router.post('/', requireAuth, requireRoles('ADMIN', 'IT_MANAGER'), async (req, res) => {
  const actor = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    const { full_name, username, email, password, role } = req.body;

    // Validate inputs presence
    if (!full_name || !username || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Seluruh field (full_name, username, email, password, role) wajib diisi.',
        },
      });
    }

    const trimmedFullName = String(full_name).trim();
    const trimmedUsername = String(username).trim().toLowerCase();
    const trimmedEmail = String(email).trim().toLowerCase();

    // Validate username format
    if (!USERNAME_REGEX.test(trimmedUsername)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USERNAME',
          message: 'Username harus terdiri dari 3-50 karakter (huruf, angka, titik, underscore, atau hyphen).',
        },
      });
    }

    // Validate password policy (minimum 8 characters)
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'WEAK_PASSWORD',
          message: 'Password minimal harus terdiri dari 8 karakter.',
        },
      });
    }

    // Validate role validity
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ROLE',
          message: `Role tidak valid. Pilihan role: ${ALLOWED_ROLES.join(', ')}.`,
        },
      });
    }

    // Privilege escalation check (Role Provisioning Authorization Matrix)
    if (!canProvisionRole(actor.role, role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PRIVILEGE_ESCALATION_DENIED',
          message: `Role ${actor.role} tidak memiliki izin untuk membuat akun dengan role ${role}.`,
        },
      });
    }

    // Check duplicate username or email
    const duplicateCheck = await db.query(
      'SELECT id, username, email FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $2',
      [trimmedUsername, trimmedEmail]
    );

    if (duplicateCheck.rows.length > 0) {
      const existing = duplicateCheck.rows[0];
      const isUsernameDuplicate = existing.username.toLowerCase() === trimmedUsername;
      return res.status(409).json({
        success: false,
        error: {
          code: isUsernameDuplicate ? 'DUPLICATE_USERNAME' : 'DUPLICATE_EMAIL',
          message: isUsernameDuplicate
            ? 'Username tersebut sudah terdaftar.'
            : 'Alamat email tersebut sudah terdaftar.',
        },
      });
    }

    // Hash password with bcrypt
    const passwordHash = await hashPassword(password);

    // Insert new user
    const insertRes = await db.query(`
      INSERT INTO users (full_name, username, email, password_hash, role, is_active)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      RETURNING id, full_name, username, email, role, is_active, created_at;
    `, [trimmedFullName, trimmedUsername, trimmedEmail, passwordHash, role]);

    const newUser = insertRes.rows[0];

    // Record audit log
    await recordAuditLog({
      userId: actor.id,
      action: 'ACCOUNT_CREATED',
      entityName: 'user',
      entityId: newUser.id,
      changes: {
        created_by_role: actor.role,
        target_username: newUser.username,
        target_role: newUser.role,
      },
      ipAddress,
      userAgent,
    });

    return res.status(201).json({
      success: true,
      data: newUser,
      message: 'Akun staf IT berhasil dibuat.',
    });
  } catch (err) {
    console.error('[Admin Users Error - POST /]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat membuat akun.',
      },
    });
  }
});

/**
 * PATCH /api/v1/admin/users/:id/status
 * Protected: ADMIN and IT_MANAGER
 * Body: { is_active: boolean }
 */
router.patch('/:id/status', requireAuth, requireRoles('ADMIN', 'IT_MANAGER'), async (req, res) => {
  const actor = req.user;
  const { id } = req.params;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Format ID pengguna tidak valid.',
        },
      });
    }

    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Field is_active harus berupa boolean (true/false).',
        },
      });
    }

    // Lookup target user
    const targetRes = await db.query(
      'SELECT id, username, role, is_active FROM users WHERE id = $1',
      [id]
    );

    if (targetRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Akun pengguna tidak ditemukan.',
        },
      });
    }

    const targetUser = targetRes.rows[0];

    // Prevent non-admin from deactivating ADMIN or another IT_MANAGER
    if (actor.role === 'IT_MANAGER' && targetUser.role !== 'IT_SUPPORT') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'IT Manager hanya berwenang mengelola status akun IT Support.',
        },
      });
    }

    // Prevent actor from deactivating their own account
    if (actor.id === targetUser.id && !is_active) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'CANNOT_DEACTIVATE_SELF',
          message: 'Anda tidak dapat menonaktifkan akun Anda sendiri.',
        },
      });
    }

    // Update status
    await db.query(
      'UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [is_active, id]
    );

    // Audit log
    await recordAuditLog({
      userId: actor.id,
      action: is_active ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DISABLED',
      entityName: 'user',
      entityId: id,
      changes: { previous_state: targetUser.is_active, new_state: is_active },
      ipAddress,
      userAgent,
    });

    return res.status(200).json({
      success: true,
      data: {
        id,
        username: targetUser.username,
        is_active,
      },
      message: `Akun ${targetUser.username} berhasil ${is_active ? 'diaktifkan' : 'dinonaktifkan'}.`,
    });
  } catch (err) {
    console.error('[Admin Users Error - PATCH /:id/status]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat memperbarui status akun.',
      },
    });
  }
});

module.exports = router;
