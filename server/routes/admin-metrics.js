/**
 * Admin Operational Metrics Route
 * 
 * Provides authorized IT leadership (ADMIN and IT_MANAGER) with real-time operational
 * visibility into system health, request throughput, latencies, rate limits, and AI telemetry.
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const metrics = require('../utils/metrics');

router.get('/', requireAuth, (req, res) => {
  // Strict RBAC: Only ADMIN and IT_MANAGER may inspect server metrics
  if (req.user.role !== 'ADMIN' && req.user.role !== 'IT_MANAGER') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN_RESOURCE',
        message: 'Akses metrics operasional ditolak untuk peran ini.',
        requestId: req.id,
      },
    });
  }

  const snapshot = metrics.getSnapshot();

  return res.status(200).json({
    success: true,
    data: snapshot,
  });
});

module.exports = router;
