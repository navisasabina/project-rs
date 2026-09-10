/**
 * Global Express Error Handler Middleware
 * 
 * Intercepts all unhandled errors and malformed JSON payloads.
 * Guarantees uniform JSON error responses conforming to the API specification
 * and prevents stack trace or internal detail leakage to clients.
 */

const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  const requestId = req.id || 'unknown';

  // 1. Handle malformed JSON body from express.json()
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.warn('Malformed JSON request payload received', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
    });

    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON_PAYLOAD',
        message: 'Format payload JSON pada request body tidak valid.',
        requestId,
      },
    });
  }

  // 2. Custom application error (if provided with status and code)
  const statusCode = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
    ? err.statusCode
    : 500;

  const errorCode = err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'APPLICATION_ERROR');
  const errorMessage = statusCode === 500
    ? 'Terjadi kesalahan internal pada server.'
    : (err.message || 'Terjadi kesalahan pada server.');

  // 3. Log the error internally with full context and requestId
  logger.error('Unhandled error processed by global error handler', {
    requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode,
    errorCode,
    error: err,
  });

  // 4. Return safe, structured JSON response to client (never expose stack trace)
  return res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: errorMessage,
      requestId,
    },
  });
}

module.exports = errorHandler;
