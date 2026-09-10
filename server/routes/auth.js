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
  signToken,
  getCookieOptions,
  COOKIE_NAME,
  recordAuditLog,
} = require('../services/auth');
const { requireAuth } = require('../middleware/auth');

/**
 * POST /api/v1/auth/login
 * Body: { username, password }
 */
router.post('/login', async (req, res) => {
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

module.exports = router;
