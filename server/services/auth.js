/**
 * Authentication Service
 * 
 * Handles password hashing (bcryptjs), JWT token signing & verification,
 * cookie configuration, and audit log creation.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

const BCRYPT_SALT_ROUNDS = 12;
const JWT_EXPIRES_IN = '8h';
const COOKIE_NAME = 'auth_token';
const COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

/**
 * Returns JWT secret securely from environment, or fails if in production without secret
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL SECURITY CONFIGURATION: JWT_SECRET must be defined in production!');
    }
    // Safe deterministic development secret fallback
    return 'dev-jwt-secret-rs-awal-bros-botania-minimum-32-chars';
  }
  return secret;
}

/**
 * Hash plaintext password using bcrypt
 * @param {string} password 
 * @returns {Promise<string>}
 */
async function hashPassword(password) {
  return await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Compare plaintext password with hash
 * @param {string} password 
 * @param {string} hash 
 * @returns {Promise<boolean>}
 */
async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

/**
 * Sign JWT session token
 * @param {object} user { id, username, role }
 * @returns {string} JWT token
 */
function signToken(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
  };

  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

/**
 * Verify and decode JWT session token
 * @param {string} token 
 * @returns {object} Decoded payload
 */
function verifyToken(token) {
  return jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],
  });
}

/**
 * Returns standardized HttpOnly cookie configuration
 * @returns {object}
 */
function getCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction, // HTTPS in production, false for local HTTP development
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

/**
 * Records an audit log entry in the audit_logs table
 * @param {object} params
 * @param {string|null} params.userId
 * @param {string} params.action (LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, ACCOUNT_CREATED, ACCOUNT_STATUS_UPDATED)
 * @param {string} params.entityName ('user', 'auth', 'guide', etc.)
 * @param {string} params.entityId
 * @param {object} [params.changes]
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 */
async function recordAuditLog({ userId, action, entityName, entityId, changes, ipAddress, userAgent }) {
  try {
    const query = `
      INSERT INTO audit_logs (
        user_id, action, entity_name, entity_id, changes, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    const sanitizedChanges = changes ? JSON.stringify(changes) : null;
    await db.query(query, [
      userId || null,
      action,
      entityName,
      entityId,
      sanitizedChanges,
      ipAddress || null,
      userAgent || null,
    ]);
  } catch (err) {
    // Log error on server without crashing request flow
    console.error('[Audit Log Error]: Failed to record audit log:', err.message);
  }
}

module.exports = {
  BCRYPT_SALT_ROUNDS,
  JWT_EXPIRES_IN,
  COOKIE_NAME,
  COOKIE_MAX_AGE_MS,
  getJwtSecret,
  hashPassword,
  comparePassword,
  signToken,
  verifyToken,
  getCookieOptions,
  recordAuditLog,
};
