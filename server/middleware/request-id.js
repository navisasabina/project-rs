/**
 * Request Correlation ID Middleware
 * 
 * Assigns or validates an immutable correlation ID (X-Request-Id) for every
 * incoming HTTP request to allow end-to-end tracing across server logs,
 * error responses, and client tickets.
 */

const crypto = require('crypto');

// Safe validation regex: alphanumeric, dash, underscore between 8 and 64 characters
const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

function requestIdMiddleware(req, res, next) {
  const incomingId = req.headers['x-request-id'];
  let requestId;

  if (typeof incomingId === 'string' && SAFE_REQUEST_ID_REGEX.test(incomingId.trim())) {
    requestId = incomingId.trim();
  } else {
    requestId = crypto.randomUUID();
  }

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  next();
}

module.exports = requestIdMiddleware;
