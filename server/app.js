const express = require('express');
const path = require('path');

const app = express();

// Middleware: Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

