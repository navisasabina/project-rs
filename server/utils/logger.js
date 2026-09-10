/**
 * Centralized Structured Logger
 * 
 * Lightweight, zero-dependency structured logger supporting JSON output in production
 * and readable structured output in development. Automatically redacts sensitive fields.
 */

const SENSITIVE_KEYS = [
  'password',
  'password_hash',
  'jwt',
  'token',
  'cookie',
  'authorization',
  'secret',
  'key',
  'gemini_api_key',
  'auth_token'
];

/**
 * Recursively redacts sensitive keys from log metadata
 */
function redactSensitive(data, depth = 0) {
  if (depth > 5 || data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
      stack: data.stack,
    };
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitive(item, depth + 1));
  }

  const redacted = {};
  for (const [key, value] of Object.entries(data)) {
    const isSensitive = SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s));
    if (isSensitive) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitive(value, depth + 1);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getActiveLevel() {
  const envLevel = (process.env.LOG_LEVEL || '').toLowerCase();
  if (LOG_LEVELS[envLevel] !== undefined) {
    return LOG_LEVELS[envLevel];
  }
  return process.env.NODE_ENV === 'production' ? LOG_LEVELS.info : LOG_LEVELS.debug;
}

function emit(level, message, meta = {}) {
  if (LOG_LEVELS[level] < getActiveLevel()) {
    return;
  }

  const timestamp = new Date().toISOString();
  const requestId = meta.requestId || (meta.req && meta.req.id) || undefined;

  // Clean meta from direct req reference to avoid circular structures
  const cleanMeta = { ...meta };
  delete cleanMeta.req;
  delete cleanMeta.requestId;

  const sanitizedMeta = redactSensitive(cleanMeta);

  const logRecord = {
    timestamp,
    level: level.toUpperCase(),
    message,
    ...(requestId ? { requestId } : {}),
    ...(Object.keys(sanitizedMeta).length > 0 ? { context: sanitizedMeta } : {}),
  };

  const outputString = process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json'
    ? JSON.stringify(logRecord)
    : `[${timestamp}] [${logRecord.level}]${requestId ? ` [${requestId}]` : ''} ${message} ${Object.keys(sanitizedMeta).length > 0 ? JSON.stringify(sanitizedMeta) : ''}`.trim();

  if (level === 'error') {
    process.stderr.write(outputString + '\n');
  } else {
    process.stdout.write(outputString + '\n');
  }
}

const logger = {
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
  debug: (msg, meta) => emit('debug', msg, meta),
  redact: (data) => redactSensitive(data),
};

module.exports = logger;
