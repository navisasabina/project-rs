/**
 * Authentication Rate Limiter Middleware
 * 
 * Lightweight, in-memory sliding/fixed window rate limiter specifically
 * applied to POST /api/v1/auth/login to protect against brute-force attacks.
 * 
 * Default Policy:
 * - 10 attempts per 15-minute window per IP
 * - HTTP 429 Too Many Requests when threshold exceeded
 * - Includes Retry-After header (in seconds)
 * - Trust proxy-aware via req.ip
 */

function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes default
  const max = options.max || 10; // 10 attempts default
  const message = options.message || 'Terlalu banyak percobaan login. Silakan tunggu beberapa saat sebelum mencoba kembali.';
  const code = options.code || 'TOO_MANY_REQUESTS';

  // Map of clientIp -> { count: number, resetTime: number }
  const store = new Map();

  // Periodic cleanup of expired entries every 5 minutes (unref so process does not hang)
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store.entries()) {
      if (entry.resetTime <= now) {
        store.delete(ip);
      }
    }
  }, 5 * 60 * 1000);
  cleanupTimer.unref();

  const middleware = function rateLimiter(req, res, next) {
    // Allows disabling rate limit in test scripts via environment flag
    if (process.env.RATE_LIMIT_DISABLED === 'true') {
      return next();
    }

    // Express with 'trust proxy' computes req.ip from X-Forwarded-For
    const clientIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '127.0.0.1';
    const now = Date.now();

    let entry = store.get(clientIp);
    if (!entry || entry.resetTime <= now) {
      entry = {
        count: 1,
        resetTime: now + windowMs,
      };
      store.set(clientIp, entry);
      return next();
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetTime - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        error: {
          code,
          message,
          retryAfter: retryAfterSeconds,
        },
      });
    }

    return next();
  };

  middleware.reset = () => store.clear();
  middleware.getStore = () => store;

  return middleware;
}

// Pre-configured login rate limiter: 10 attempts per 15 minutes per IP
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
});

module.exports = {
  createRateLimiter,
  loginRateLimiter,
};
