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
 * GET /api/v1/admin/users
 * Protected: All authenticated IT staff (ADMIN, IT_MANAGER, IT_SUPPORT)
 * Query: ?role=...&status=...&search=...
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { role, status, search } = req.query;

    let queryText = `
      SELECT id, full_name, username, email, role, is_active, created_at, updated_at
      FROM users
      WHERE 1=1
    `;
    const queryParams = [];

    if (role && ALLOWED_ROLES.includes(role)) {
      queryParams.push(role);
      queryText += ` AND role = $${queryParams.length}`;
    }

    if (status === 'active') {
      queryText += ` AND is_active = TRUE`;
    } else if (status === 'inactive') {
      queryText += ` AND is_active = FALSE`;
    }

    if (search && typeof search === 'string' && search.trim().length > 0) {
      queryParams.push(`%${search.trim().toLowerCase()}%`);
      queryText += ` AND (LOWER(full_name) LIKE $${queryParams.length} OR LOWER(username) LIKE $${queryParams.length} OR LOWER(email) LIKE $${queryParams.length})`;
    }

    queryText += ` ORDER BY created_at ASC`;

    const result = await db.query(queryText, queryParams);

    return res.status(200).json({
      success: true,
      data: result.rows,
      meta: {
        total: result.rows.length,
      },
    });
  } catch (err) {
    console.error('[Admin Users Error - GET /]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat mengambil daftar staf IT.',
      },
    });
  }
});

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

/**
 * PATCH /api/v1/admin/users/:id/password
 * Protected: ADMIN and IT_MANAGER
 * Body: { new_password }
 */
router.patch('/:id/password', requireAuth, requireRoles('ADMIN', 'IT_MANAGER'), async (req, res) => {
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
          requestId: req.id,
        },
      });
    }

    const { new_password } = req.body || {};
    if (!new_password || typeof new_password !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Field new_password wajib diisi.',
          requestId: req.id,
        },
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Kata sandi baru minimal 8 karakter.',
          requestId: req.id,
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
          requestId: req.id,
        },
      });
    }

    const targetUser = targetRes.rows[0];

    // Enforce role hierarchy:
    // IT_MANAGER can ONLY reset IT_SUPPORT
    if (actor.role === 'IT_MANAGER' && targetUser.role !== 'IT_SUPPORT') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'IT Manager hanya berwenang mereset kata sandi akun IT Support.',
          requestId: req.id,
        },
      });
    }

    // Hash with bcrypt 12 rounds
    const newHash = await hashPassword(new_password);

    // Update password
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newHash, targetUser.id]
    );

    // Record sanitized audit event
    await recordAuditLog({
      userId: actor.id,
      action: 'PASSWORD_RESET',
      entityName: 'user',
      entityId: targetUser.id,
      changes: {
        target_username: targetUser.username,
        target_role: targetUser.role,
        reset_by_role: actor.role,
      },
      ipAddress,
      userAgent,
    });

    return res.status(200).json({
      success: true,
      message: `Kata sandi untuk pengguna ${targetUser.username} berhasil direset.`,
      data: {
        id: targetUser.id,
        username: targetUser.username,
      },
    });
  } catch (err) {
    console.error('[Admin Users Error - PATCH /:id/password]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat mereset kata sandi.',
        requestId: req.id,
      },
    });
  }
});

/**
 * PATCH /api/v1/admin/users/:id
 * Protected: ADMIN and IT_MANAGER
 * Body: { full_name, email, role } (partial update allowed)
 */
router.patch('/:id', requireAuth, requireRoles('ADMIN', 'IT_MANAGER'), async (req, res) => {
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
          requestId: req.id,
        },
      });
    }

    const ALLOWED_UPDATE_FIELDS = ['full_name', 'email', 'role'];
    const bodyKeys = Object.keys(req.body || {});

    // Check for unsupported fields
    const unsupportedKeys = bodyKeys.filter((k) => !ALLOWED_UPDATE_FIELDS.includes(k));
    if (unsupportedKeys.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'UNSUPPORTED_FIELD',
          message: `Field tidak didukung: ${unsupportedKeys.join(', ')}.`,
          requestId: req.id,
        },
      });
    }

    if (bodyKeys.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Setidaknya satu field (full_name, email, role) harus disediakan.',
          requestId: req.id,
        },
      });
    }

    // Lookup target user
    const targetRes = await db.query(
      'SELECT id, full_name, username, email, role, is_active FROM users WHERE id = $1',
      [id]
    );

    if (targetRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Akun pengguna tidak ditemukan.',
          requestId: req.id,
        },
      });
    }

    const targetUser = targetRes.rows[0];

    // Enforce role hierarchy:
    // IT_MANAGER can ONLY update IT_SUPPORT
    if (actor.role === 'IT_MANAGER' && targetUser.role !== 'IT_SUPPORT') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'IT Manager hanya berwenang mengelola akun IT Support.',
          requestId: req.id,
        },
      });
    }

    const { full_name, email, role } = req.body;
    const updates = [];
    const values = [];
    const changes = { previous: {}, updated: {} };

    // Validate and process full_name
    if (full_name !== undefined) {
      if (typeof full_name !== 'string' || full_name.trim().length < 2 || full_name.trim().length > 100) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Nama lengkap harus antara 2 dan 100 karakter.',
            requestId: req.id,
          },
        });
      }
      const trimmedName = full_name.trim();
      values.push(trimmedName);
      updates.push(`full_name = $${values.length}`);
      changes.previous.full_name = targetUser.full_name;
      changes.updated.full_name = trimmedName;
    }

    // Validate and process email
    if (email !== undefined) {
      const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim()) || email.trim().length > 100) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_EMAIL',
            message: 'Format alamat email tidak valid.',
            requestId: req.id,
          },
        });
      }
      const trimmedEmail = email.trim().toLowerCase();

      // Check if email already in use by another user
      const emailCheck = await db.query(
        'SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2',
        [trimmedEmail, targetUser.id]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'DUPLICATE_EMAIL',
            message: 'Alamat email tersebut sudah terdaftar.',
            requestId: req.id,
          },
        });
      }

      values.push(trimmedEmail);
      updates.push(`email = $${values.length}`);
      changes.previous.email = targetUser.email;
      changes.updated.email = trimmedEmail;
    }

    // Validate and process role
    if (role !== undefined) {
      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ROLE',
            message: `Role tidak valid. Pilihan role: ${ALLOWED_ROLES.join(', ')}.`,
            requestId: req.id,
          },
        });
      }

      // Hierarchy check:
      // IT_MANAGER cannot promote to ADMIN or IT_MANAGER
      if (actor.role === 'IT_MANAGER' && role !== 'IT_SUPPORT') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'PRIVILEGE_ESCALATION_DENIED',
            message: `IT Manager tidak memiliki izin untuk mengubah role menjadi ${role}.`,
            requestId: req.id,
          },
        });
      }

      // Anti-self-demotion: ADMIN cannot demote self from ADMIN
      if (actor.id === targetUser.id && role !== 'ADMIN') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CANNOT_DEMOTE_SELF',
            message: 'Anda tidak dapat menurunkan role akun Administrator Anda sendiri.',
            requestId: req.id,
          },
        });
      }

      values.push(role);
      updates.push(`role = $${values.length}`);
      changes.previous.role = targetUser.role;
      changes.updated.role = role;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_CHANGES',
          message: 'Tidak ada perubahan yang dilakukan.',
          requestId: req.id,
        },
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(targetUser.id);
    const updateQuery = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${values.length}
      RETURNING id, full_name, username, email, role, is_active, updated_at;
    `;

    let updateRes;
    try {
      updateRes = await db.query(updateQuery, values);
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        return res.status(409).json({
          success: false,
          error: {
            code: 'DUPLICATE_EMAIL',
            message: 'Alamat email tersebut sudah terdaftar.',
            requestId: req.id,
          },
        });
      }
      throw dbErr;
    }

    const updatedUser = updateRes.rows[0];

    // Record audit log
    await recordAuditLog({
      userId: actor.id,
      action: 'USER_UPDATED',
      entityName: 'user',
      entityId: updatedUser.id,
      changes: {
        target_username: targetUser.username,
        ...changes,
      },
      ipAddress,
      userAgent,
    });

    return res.status(200).json({
      success: true,
      message: 'Profil staf IT berhasil diperbarui.',
      data: updatedUser,
    });
  } catch (err) {
    console.error('[Admin Users Error - PATCH /:id]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat memperbarui profil pengguna.',
        requestId: req.id,
      },
    });
  }
});

module.exports = router;
