/**
 * Authentication Routes
 * 
 * Implements:
 * - POST /api/v1/auth/login  (Username/password authentication, HttpOnly cookie set, generic failure message)
 * - POST /api/v1/auth/logout (Clears session cookie safely)
 * - GET  /api/v1/auth/me     (Returns current authenticated user session data, no sensitive hash/tokens)
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const {
  comparePassword,
  hashPassword,
  signToken,
  getCookieOptions,
  COOKIE_NAME,
  recordAuditLog,
} = require('../services/auth');
const { requireAuth } = require('../middleware/auth');
const { loginRateLimiter } = require('../middleware/rate-limiter');

/**
 * POST /api/v1/auth/login
 * Body: { username, password }
 */
router.post('/login', loginRateLimiter, async (req, res) => {
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    const { username, password } = req.body;

    // Validate inputs
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Username dan password wajib diisi.',
        },
      });
    }

    const trimmedUsername = username.trim().toLowerCase();

    // Query user by username
    const userRes = await db.query(
      'SELECT id, full_name, username, email, password_hash, role, is_active FROM users WHERE LOWER(username) = $1',
      [trimmedUsername]
    );

    // Generic error message to prevent username enumeration
    const genericAuthError = {
      success: false,
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Username atau password salah.',
      },
    };

    if (userRes.rows.length === 0) {
      // Record failed login audit log (with dummy uuid for entity tracking)
      await recordAuditLog({
        userId: null,
        action: 'LOGIN_FAILED',
        entityName: 'auth',
        entityId: '00000000-0000-0000-0000-000000000000',
        changes: { username: trimmedUsername, reason: 'user_not_found' },
        ipAddress,
        userAgent,
      });

      return res.status(401).json(genericAuthError);
    }

    const user = userRes.rows[0];

    // Check password hash
    const isPasswordValid = await comparePassword(password, user.password_hash);
    if (!isPasswordValid) {
      await recordAuditLog({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entityName: 'auth',
        entityId: user.id,
        changes: { username: trimmedUsername, reason: 'invalid_password' },
        ipAddress,
        userAgent,
      });

      return res.status(401).json(genericAuthError);
    }

    // Check is_active
    if (!user.is_active) {
      await recordAuditLog({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entityName: 'auth',
        entityId: user.id,
        changes: { username: trimmedUsername, reason: 'account_inactive' },
        ipAddress,
        userAgent,
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_INACTIVE',
          message: 'Akun Anda telah dinonaktifkan. Silakan hubungi Administrator IT.',
        },
      });
    }

    // Generate JWT token
    const token = signToken({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    // Set secure HttpOnly cookie
    res.cookie(COOKIE_NAME, token, getCookieOptions());

    // Record audit log
    await recordAuditLog({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      entityName: 'auth',
      entityId: user.id,
      changes: { role: user.role },
      ipAddress,
      userAgent,
    });

    // Return safe user profile (NEVER return password hash or token in body)
    return res.status(200).json({
      success: true,
      data: {
        id: user.id,
        full_name: user.full_name,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      message: 'Login berhasil.',
    });
  } catch (err) {
    console.error('[Auth Route Error - POST /login]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat memproses login.',
      },
    });
  }
});

/**
 * POST /api/v1/auth/logout
 * Clears HttpOnly session cookie
 */
router.post('/logout', async (req, res) => {
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    // Attempt audit if user was authenticated
    const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
    let userId = null;
    if (token) {
      try {
        const { verifyToken } = require('../services/auth');
        const decoded = verifyToken(token);
        userId = decoded.sub;
      } catch (e) {}
    }

    if (userId) {
      await recordAuditLog({
        userId,
        action: 'LOGOUT',
        entityName: 'auth',
        entityId: userId,
        changes: null,
        ipAddress,
        userAgent,
      });
    }

    // Clear cookie with exact path
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });

    return res.status(200).json({
      success: true,
      message: 'Logout berhasil.',
    });
  } catch (err) {
    console.error('[Auth Route Error - POST /logout]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat memproses logout.',
      },
    });
  }
});

/**
 * GET /api/v1/auth/me
 * Protected endpoint returning active session user profile
 */
router.get('/me', requireAuth, (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      id: req.user.id,
      full_name: req.user.full_name,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      is_active: req.user.is_active,
    },
  });
});

/**
 * PATCH /api/v1/auth/password
 * Self-service password change for authenticated active user
 * Body: { current_password, new_password, confirm_password }
 */
router.patch('/password', requireAuth, async (req, res) => {
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    const { current_password, new_password, confirm_password } = req.body || {};

    if (
      !current_password ||
      !new_password ||
      !confirm_password ||
      typeof current_password !== 'string' ||
      typeof new_password !== 'string' ||
      typeof confirm_password !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Seluruh field (current_password, new_password, confirm_password) wajib diisi.',
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

    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Konfirmasi kata sandi baru tidak cocok.',
          requestId: req.id,
        },
      });
    }

    // Retrieve user's current password_hash from DB
    const userRes = await db.query(
      'SELECT id, username, password_hash, is_active FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Pengguna tidak ditemukan.',
          requestId: req.id,
        },
      });
    }

    const user = userRes.rows[0];

    // Verify current password
    const isCurrentValid = await comparePassword(current_password, user.password_hash);
    if (!isCurrentValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Kata sandi saat ini salah.',
          requestId: req.id,
        },
      });
    }

    // Prevent new password being identical to current password
    const isSame = await comparePassword(new_password, user.password_hash);
    if (isSame) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'SAME_PASSWORD',
          message: 'Kata sandi baru tidak boleh sama dengan kata sandi saat ini.',
          requestId: req.id,
        },
      });
    }

    // Hash new password using 12 bcrypt rounds
    const newHash = await hashPassword(new_password);

    // Update password_hash atomically
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newHash, user.id]
    );

    // Record sanitized audit event
    await recordAuditLog({
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      entityName: 'user',
      entityId: user.id,
      changes: { reason: 'self_service_update' },
      ipAddress,
      userAgent,
    });

    return res.status(200).json({
      success: true,
      message: 'Kata sandi berhasil diperbarui.',
    });
  } catch (err) {
    console.error('[Auth Route Error - PATCH /password]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat memperbarui kata sandi.',
        requestId: req.id,
      },
    });
  }
});

module.exports = router;
