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

module.exports = app;
