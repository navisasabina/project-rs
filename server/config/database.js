const { Pool } = require('pg');
require('dotenv').config();

// Pool configuration reading strictly from environment variables with safe production defaults
const maxPool = parseInt(process.env.DB_POOL_MAX, 10);
const idleTimeout = parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS, 10);
const connectionTimeout = parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS, 10);

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      max: (!isNaN(maxPool) && maxPool > 0) ? maxPool : 30,
      idleTimeoutMillis: (!isNaN(idleTimeout) && idleTimeout >= 0) ? idleTimeout : 30000,
      connectionTimeoutMillis: (!isNaN(connectionTimeout) && connectionTimeout >= 0) ? connectionTimeout : 5000,
    }
  : {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
      database: process.env.POSTGRES_DB || 'rs_awal_bros_kb',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      max: (!isNaN(maxPool) && maxPool > 0) ? maxPool : 30,
      idleTimeoutMillis: (!isNaN(idleTimeout) && idleTimeout >= 0) ? idleTimeout : 30000,
      connectionTimeoutMillis: (!isNaN(connectionTimeout) && connectionTimeout >= 0) ? connectionTimeout : 5000,
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

module.exports = {
  pool,
  poolConfig,
  query: (text, params) => pool.query(text, params),
};
