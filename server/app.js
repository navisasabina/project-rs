const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();

// Middleware: Body parser & Cookies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve existing User Portal static files from root directory
// Ensures index.html, css/, js/, and images work with zero regression
const rootDir = path.resolve(__dirname, '..');
app.use(express.static(rootDir));

// M0 Health Check Foundation Endpoint
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// M3 Public Knowledge Base API Routes
const categoriesRouter = require('./routes/categories');
const guidesRouter = require('./routes/guides');

app.use('/api/v1/categories', categoriesRouter);
app.use('/api/v1/guides', guidesRouter);

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

// M7 Admin Dashboard Web Pages
app.get('/admin/login', (req, res) => {
  res.sendFile(path.resolve(rootDir, 'admin-login.html'));
});

app.get(['/admin', '/admin/*'], (req, res) => {
  res.sendFile(path.resolve(rootDir, 'admin.html'));
});

// Fallback 404 handler for unmatched /api/* requests
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'Endpoint API tidak ditemukan.',
    },
  });
});

module.exports = app;

