/**
 * Authentication & Role Authorization Middleware
 * 
 * Extracts HttpOnly cookie, verifies JWT session token, checks user active status in database,
 * and enforces role hierarchy and provisioning permission boundaries.
 */

const { verifyToken, COOKIE_NAME } = require('../services/auth');
const db = require('../config/database');

/**
 * Middleware: Requires a valid active session token
 */
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies ? req.cookies[COOKIE_NAME] : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Sesi tidak ditemukan atau telah berakhir. Silakan login kembali.',
        },
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token sesi tidak valid atau kedaluwarsa.',
        },
      });
    }

    // Check user active status in database (ensures deactivated users are blocked immediately)
    const userRes = await db.query(
      'SELECT id, full_name, username, email, role, is_active FROM users WHERE id = $1',
      [decoded.sub]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Pengguna akun tidak ditemukan.',
        },
      });
    }

    const user = userRes.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_INACTIVE',
          message: 'Akun Anda telah dinonaktifkan. Hubungi Administrator IT.',
        },
      });
    }

    // Attach authenticated user to request
    req.user = user;
    next();
  } catch (err) {
    console.error('[Auth Middleware Error]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan pada verifikasi autentikasi.',
      },
    });
  }
}

/**
 * Middleware: Enforces that requester possesses one of the allowed roles
 * @param  {...string} allowedRoles ('ADMIN', 'IT_MANAGER', 'IT_SUPPORT')
 */
function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Autentikasi diperlukan.',
        },
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Akses ditolak. Anda tidak memiliki izin untuk tindakan ini.',
        },
      });
    }

    next();
  };
}

/**
 * Role Provisioning Authorization Matrix:
 * ADMIN -> Can create ADMIN, IT_MANAGER, IT_SUPPORT
 * IT_MANAGER -> Can ONLY create IT_SUPPORT (Cannot escalate to ADMIN or IT_MANAGER)
 * IT_SUPPORT -> Cannot create accounts (403)
 */
const ROLE_PROVISIONING_MATRIX = {
  ADMIN: ['ADMIN', 'IT_MANAGER', 'IT_SUPPORT'],
  IT_MANAGER: ['IT_SUPPORT'],
  IT_SUPPORT: [],
};

/**
 * Validates whether the actor is authorized to provision or target a specific role
 * @param {string} actorRole 
 * @param {string} targetRole 
 * @returns {boolean}
 */
function canProvisionRole(actorRole, targetRole) {
  const allowed = ROLE_PROVISIONING_MATRIX[actorRole] || [];
  return allowed.includes(targetRole);
}

module.exports = {
  requireAuth,
  requireRoles,
  ROLE_PROVISIONING_MATRIX,
  canProvisionRole,
};
