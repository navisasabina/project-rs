/**
 * Security Headers Middleware
 * 
 * Implements OWASP-recommended HTTP security headers tailored specifically
 * for the RS Awal Bros Botania Knowledge Base:
 * - Content-Security-Policy: strictly scoped to self, Tailwind CDN, Google Fonts, and RS assets
 * - X-Frame-Options: SAMEORIGIN (prevents clickjacking)
 * - X-Content-Type-Options: nosniff (prevents MIME confusion)
 * - Referrer-Policy: strict-origin-when-cross-origin
 * - X-XSS-Protection: 0 (modern recommendation deferring to CSP)
 * - Strict-Transport-Security: HSTS enabled in production
 */

function securityHeaders(req, res, next) {
  // Content Security Policy
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://lh3.googleusercontent.com",
    "connect-src 'self'",
    "frame-ancestors 'self'",
  ];

  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');

  // Enforce HSTS when running in production
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

module.exports = securityHeaders;
