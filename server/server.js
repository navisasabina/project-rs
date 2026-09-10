const app = require('./app');
const db = require('./config/database');
const { validateJwtSecret } = require('./services/auth');

// Fail-fast validation: ensure safe JWT configuration before accepting connections
try {
  validateJwtSecret(process.env.JWT_SECRET, process.env.NODE_ENV);
} catch (configErr) {
  console.error(`[Startup Error] ${configErr.message}`);
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`[RS Awal Bros Server] Berjalan pada port ${PORT}`);
  console.log(`[User Portal] http://localhost:${PORT}`);
  console.log(`[Health Endpoint] http://localhost:${PORT}/api/v1/health`);
  console.log(`[Readiness Endpoint] http://localhost:${PORT}/api/v1/health/ready`);
});

// Graceful Shutdown Handler
let isShuttingDown = false;

function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Shutdown] Menerima sinyal ${signal}. Menutup server secara graceful...`);

  // Force shutdown after 10 seconds to avoid hanging indefinitely
  const forceTimeout = setTimeout(() => {
    console.error('[Shutdown Error] Batas waktu penutupan habis (10 detik). Menghentikan paksa.');
    process.exit(1);
  }, 10000);
  forceTimeout.unref();

  // 1. Stop accepting new HTTP connections
  server.close(async (err) => {
    if (err) {
      console.error('[Shutdown Error] Terjadi kendala saat menutup HTTP server:', err.message);
    } else {
      console.log('[Shutdown] HTTP server berhenti menerima koneksi baru.');
    }

    // 2. Close PostgreSQL connection pool
    try {
      if (db.pool) {
        await db.pool.end();
        console.log('[Shutdown] Pool database PostgreSQL ditutup dengan aman.');
      }
    } catch (poolErr) {
      console.error('[Shutdown Error] Gagal menutup pool database:', poolErr.message);
    }

    console.log('[Shutdown] Penutupan selesai dengan aman.');
    process.exit(err ? 1 : 0);
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

module.exports = server;
