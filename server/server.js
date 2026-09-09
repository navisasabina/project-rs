const app = require('./app');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`[RS Awal Bros Server] Berjalan pada port ${PORT}`);
  console.log(`[User Portal] http://localhost:${PORT}`);
  console.log(`[Health Endpoint] http://localhost:${PORT}/api/v1/health`);
});

module.exports = server;
