const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const securityHeaders = require('./middleware/security');
const requestIdMiddleware = require('./middleware/request-id');
const errorHandler = require('./middleware/error-handler');
const logger = require('./utils/logger');
const metrics = require('./utils/metrics');

const app = express();

// Configure trust proxy deliberately for container and reverse proxy networks (1 hop)
app.set('trust proxy', 1);

// M11 Request correlation ID (mounted first so req.id is available everywhere)
app.use(requestIdMiddleware);

// M11 Access logging & metrics duration tracking
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    metrics.recordRequest(res.statusCode, duration);
    if (req.path.startsWith('/api')) {
      logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`, {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: duration,
      });
    }
  });
  next();
});

// Middleware: Security headers, Body parser & Cookies
app.use(securityHeaders);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve existing User Portal static files from root directory
// Ensures index.html, css/, js/, and images work with zero regression
const rootDir = path.resolve(__dirname, '..');
app.use(express.static(rootDir));

// M0 Health Check Foundation Endpoint (Liveness Probe)
// Enhanced in M11 with process uptime and memory usage diagnostics
app.get('/api/v1/health', (req, res) => {
  const mem = process.memoryUsage();
  res.status(200).json({
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: {
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
    },
  });
});

// M9 Operational Readiness Check Endpoint (Readiness Probe)
app.get('/api/v1/health/ready', async (req, res) => {
  try {
    const db = require('./config/database');
    await db.query('SELECT 1');
    res.status(200).json({
      status: 'ok',
      database: 'connected',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message,
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    });
  }
});

// M3 Public Knowledge Base API Routes
const categoriesRouter = require('./routes/categories');
const guidesRouter = require('./routes/guides');
const aiRouter = require('./routes/ai');

app.use('/api/v1/categories', categoriesRouter);
app.use('/api/v1/guides', guidesRouter);
app.use('/api/v1/ai', aiRouter);

// M5 Authentication & Account Provisioning Routes
const authRouter = require('./routes/auth');
const adminUsersRouter = require('./routes/admin-users');

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/admin/users', adminUsersRouter);

// M6 Admin Knowledge Base Management API Routes (CRUD Categories, Guides, Steps, Status)
const adminCategoriesRouter = require('./routes/admin-categories');
const adminGuidesRouter = require('./routes/admin-guides');

app.use('/api/v1/admin/categories', adminCategoriesRouter);
app.use('/api/v1/admin/guides', adminGuidesRouter);

// M8 Admin Audit Trail Route
const adminAuditLogsRouter = require('./routes/admin-audit-logs');
app.use('/api/v1/admin/audit-logs', adminAuditLogsRouter);

// M11 Admin Operational Metrics Route
const adminMetricsRouter = require('./routes/admin-metrics');
app.use('/api/v1/admin/metrics', adminMetricsRouter);

// M7 Admin Dashboard Web Pages
app.get('/admin/login', (req, res) => {
  res.sendFile(path.resolve(rootDir, 'admin-login.html'));
});

app.get(['/admin', '/admin/*'], (req, res) => {
  res.sendFile(path.resolve(rootDir, 'admin.html'));
});

// Test crash simulation endpoint for automated verification of global error handler (only enabled in test mode)
if (process.env.NODE_ENV === 'test') {
  app.get('/api/v1/test-crash-simulation', (req, res, next) => {
    const secretError = new Error('Database disk error at /var/lib/postgresql/data/base/16384: SELECT * FROM confidential_secrets');
    secretError.stack = 'Error: Database disk error\n    at internalQuery (/app/server/secret-driver.js:42:15)\n    at Object.query (/app/node_modules/pg/index.js:10:5)';
    next(secretError);
  });
}

// Fallback 404 handler for unmatched /api/* requests
app.use(['/api', '/api/*'], (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'Endpoint API tidak ditemukan.',
      requestId: req.id,
    },
  });
});

// M11 Global Centralized Error Handler
app.use(errorHandler);

module.exports = app;
