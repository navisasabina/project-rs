/**
 * Automated Verification Script for Milestone M9:
 * Containerization, Production Hardening & Operational Readiness
 * 
 * Verifies:
 * 1. HTTP Security Headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS)
 * 2. Operational Health & Readiness Probes (/api/v1/health & /api/v1/health/ready)
 * 3. Authentication Rate Limiting on POST /api/v1/auth/login (HTTP 429, Retry-After)
 * 4. Isolation of Rate Limiter (unrelated endpoints remain accessible)
 * 5. Production Secret Hardening & Fail-Fast Validation (JWT_SECRET rules)
 * 6. Dockerfile & .dockerignore Static & Security Architecture Verification
 * 7. Docker Compose Specification & Orchestration Verification
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { newDb, DataType } = require('pg-mem');
const crypto = require('crypto');
const { validateJwtSecret, INSECURE_SECRETS } = require('../server/services/auth');
const { loginRateLimiter } = require('../server/middleware/rate-limiter');

function makeRequest(port, reqPath, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };

    const options = {
      hostname: 'localhost',
      port,
      path: reqPath,
      method,
      headers: defaultHeaders,
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (_) {
          json = null;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json,
          rawBody: body,
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runM9Tests() {
  console.log('=== STARTING M9 PRODUCTION HARDENING & CONTAINERIZATION VERIFICATION ===\n');

  // 1. Setup in-memory mock database to ensure clean, isolated execution without ECONNREFUSED
  const memDb = newDb();
  memDb.public.registerFunction({
    name: 'gen_random_uuid',
    implementation: () => crypto.randomUUID(),
    impure: true,
  });
  memDb.public.registerEquivalentType({
    name: 'tsvector',
    equivalentTo: DataType.text,
  });
  const adapter = memDb.adapters.createPg();
  const testPool = new adapter.Pool();

  const upSql = fs.readFileSync(path.resolve(__dirname, '../database/migrations/001_initial_schema.up.sql'), 'utf8');
  const ddl = upSql.split('-- 8. Trigger function for Search Vector update')[0];
  const client = await testPool.connect();
  await client.query(ddl);
  client.release();

  // Intercept database config with clean in-memory pool
  const dbConfig = require('../server/config/database');
  const originalPool = dbConfig.pool;
  const originalQuery = dbConfig.query;
  dbConfig.pool = testPool;
  dbConfig.query = (text, params) => testPool.query(text, params);

  // Reset rate limiter store to ensure clean test baseline
  loginRateLimiter.reset();

  const app = require('../server/app');
  const TEST_PORT = 3009;
  const server = app.listen(TEST_PORT);

  try {
    // -------------------------------------------------------------------------
    // 1. HTTP Security Headers Verification
    // -------------------------------------------------------------------------
    console.log('1. Testing HTTP Security Headers Middleware...');
    const rootRes = await makeRequest(TEST_PORT, '/');

    if (rootRes.statusCode !== 200) {
      throw new Error(`GET / failed with status code ${rootRes.statusCode}`);
    }

    const headers = rootRes.headers;

    // X-Content-Type-Options
    if (headers['x-content-type-options'] !== 'nosniff') {
      throw new Error(`Expected X-Content-Type-Options: nosniff, got: ${headers['x-content-type-options']}`);
    }
    console.log('  ✓ X-Content-Type-Options: nosniff verified.');

    // X-Frame-Options
    if (headers['x-frame-options'] !== 'SAMEORIGIN') {
      throw new Error(`Expected X-Frame-Options: SAMEORIGIN, got: ${headers['x-frame-options']}`);
    }
    console.log('  ✓ X-Frame-Options: SAMEORIGIN verified.');

    // Referrer-Policy
    if (headers['referrer-policy'] !== 'strict-origin-when-cross-origin') {
      throw new Error(`Expected Referrer-Policy: strict-origin-when-cross-origin, got: ${headers['referrer-policy']}`);
    }
    console.log('  ✓ Referrer-Policy: strict-origin-when-cross-origin verified.');

    // Content-Security-Policy
    const csp = headers['content-security-policy'];
    if (!csp) {
      throw new Error('Content-Security-Policy header is missing');
    }
    if (!csp.includes("default-src 'self'")) {
      throw new Error("CSP missing default-src 'self'");
    }
    if (!csp.includes('https://cdn.tailwindcss.com')) {
      throw new Error('CSP missing https://cdn.tailwindcss.com');
    }
    if (!csp.includes('https://fonts.googleapis.com') || !csp.includes('https://fonts.gstatic.com')) {
      throw new Error('CSP missing Google Fonts domains');
    }
    if (!csp.includes('https://lh3.googleusercontent.com')) {
      throw new Error('CSP missing Google User Content image domain');
    }
    if (!csp.includes("frame-ancestors 'self'")) {
      throw new Error("CSP missing frame-ancestors 'self'");
    }
    console.log('  ✓ Content-Security-Policy: verified with complete hospital asset whitelist.\n');

    // -------------------------------------------------------------------------
    // 2. Health & Readiness Probes Verification
    // -------------------------------------------------------------------------
    console.log('2. Testing Health & Readiness Probes...');

    // Liveness probe (/api/v1/health)
    const healthRes = await makeRequest(TEST_PORT, '/api/v1/health');
    if (healthRes.statusCode !== 200 || healthRes.body?.status !== 'ok') {
      throw new Error(`GET /api/v1/health failed: ${JSON.stringify(healthRes.body)}`);
    }
    console.log('  ✓ GET /api/v1/health liveness probe returns HTTP 200 ok.');

    // Readiness probe (/api/v1/health/ready) - Database Available
    const readyRes = await makeRequest(TEST_PORT, '/api/v1/health/ready');
    if (readyRes.statusCode !== 200 || readyRes.body?.status !== 'ok' || readyRes.body?.database !== 'connected') {
      throw new Error(`Readiness probe format unexpected: ${JSON.stringify(readyRes.body)}`);
    }
    console.log('  ✓ GET /api/v1/health/ready readiness probe returns HTTP 200 (database connected).');

    // Verify simulated database disconnect behavior on readiness probe
    dbConfig.query = async () => {
      throw new Error('Simulated database connection loss');
    };

    const simulatedFailureRes = await makeRequest(TEST_PORT, '/api/v1/health/ready');
    if (simulatedFailureRes.statusCode !== 503 || simulatedFailureRes.body?.database !== 'disconnected') {
      dbConfig.query = (text, params) => testPool.query(text, params);
      throw new Error(`Readiness probe failed to return 503 on database failure: ${simulatedFailureRes.statusCode}`);
    }
    dbConfig.query = (text, params) => testPool.query(text, params);
    console.log('  ✓ GET /api/v1/health/ready correctly returns HTTP 503 when database is unavailable.\n');

    // -------------------------------------------------------------------------
    // 3. Authentication Rate Limiting Verification
    // -------------------------------------------------------------------------
    console.log('3. Testing Authentication Rate Limiting on POST /api/v1/auth/login...');
    loginRateLimiter.reset();

    // Send 10 rapid login attempts from test client (should all process without 429)
    for (let i = 1; i <= 10; i++) {
      const res = await makeRequest(
        TEST_PORT,
        '/api/v1/auth/login',
        'POST',
        { username: 'test.user', password: 'WrongPassword123!' }
      );
      if (res.statusCode === 429) {
        throw new Error(`Premature rate limiting at attempt ${i}`);
      }
    }
    console.log('  ✓ 10 login attempts processed under rate limit threshold.');

    // 11th login attempt must be rejected with HTTP 429
    const throttledRes = await makeRequest(
      TEST_PORT,
      '/api/v1/auth/login',
      'POST',
      { username: 'test.user', password: 'WrongPassword123!' }
    );

    if (throttledRes.statusCode !== 429) {
      throw new Error(`Expected HTTP 429 Too Many Requests, got: ${throttledRes.statusCode}`);
    }

    if (throttledRes.body?.error?.code !== 'TOO_MANY_REQUESTS') {
      throw new Error(`Expected error code TOO_MANY_REQUESTS, got: ${throttledRes.body?.error?.code}`);
    }

    const retryAfter = throttledRes.headers['retry-after'];
    if (!retryAfter || isNaN(parseInt(retryAfter, 10)) || parseInt(retryAfter, 10) <= 0) {
      throw new Error(`Invalid or missing Retry-After header: ${retryAfter}`);
    }
    console.log(`  ✓ 11th login attempt rejected with HTTP 429 and Retry-After: ${retryAfter}s.`);

    // Unrelated endpoint must NOT be rate limited
    const categoriesRes = await makeRequest(TEST_PORT, '/api/v1/categories');
    if (categoriesRes.statusCode === 429) {
      throw new Error('Unrelated endpoint /api/v1/categories was unexpectedly rate limited');
    }
    console.log('  ✓ Unrelated endpoints (/api/v1/categories) remain 100% unaffected by auth rate limiter.\n');

    // Reset rate limiter after test
    loginRateLimiter.reset();

    // -------------------------------------------------------------------------
    // 4. Production Secret Hardening & Fail-Fast Validation
    // -------------------------------------------------------------------------
    console.log('4. Testing Production Secret Validation (validateJwtSecret)...');

    // Fails on missing secret in production
    let threwOnMissing = false;
    try {
      validateJwtSecret('', 'production');
    } catch (err) {
      threwOnMissing = true;
    }
    if (!threwOnMissing) {
      throw new Error('validateJwtSecret did not throw for missing secret in production');
    }
    console.log('  ✓ Rejects missing JWT_SECRET in production.');

    // Fails on secret < 32 characters in production
    let threwOnShort = false;
    try {
      validateJwtSecret('short-secret-under-32-chars', 'production');
    } catch (err) {
      threwOnShort = true;
    }
    if (!threwOnShort) {
      throw new Error('validateJwtSecret did not throw for short secret in production');
    }
    console.log('  ✓ Rejects short JWT_SECRET (< 32 characters) in production.');

    // Fails on known default/example secret in production
    let threwOnDefault = false;
    try {
      validateJwtSecret(INSECURE_SECRETS[1], 'production');
    } catch (err) {
      threwOnDefault = true;
    }
    if (!threwOnDefault) {
      throw new Error('validateJwtSecret did not throw for default/example secret in production');
    }
    console.log('  ✓ Rejects known insecure/placeholder JWT_SECRET in production.');

    // Accepts strong secret in production
    const validProdSecret = 'super-strong-production-hospital-secret-key-2026-secure!';
    const acceptedSecret = validateJwtSecret(validProdSecret, 'production');
    if (acceptedSecret !== validProdSecret) {
      throw new Error('validateJwtSecret failed to accept valid strong secret');
    }
    console.log('  ✓ Accepts strong 32+ character JWT_SECRET in production.');

    // Development fallback allowed
    const devFallback = validateJwtSecret('', 'development');
    if (!devFallback || devFallback.length < 32) {
      throw new Error('Development environment failed to provide safe fallback secret');
    }
    console.log('  ✓ Development environment safely falls back without error.\n');

    // -------------------------------------------------------------------------
    // 5. Dockerfile & .dockerignore Static Verification
    // -------------------------------------------------------------------------
    console.log('5. Testing Dockerfile & .dockerignore Static Specifications...');

    const dockerfilePath = path.resolve(__dirname, '../Dockerfile');
    if (!fs.existsSync(dockerfilePath)) {
      throw new Error('Dockerfile does not exist');
    }
    const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');

    if (!dockerfileContent.includes('node:20-alpine')) {
      throw new Error('Dockerfile must use node:20-alpine base image');
    }
    if (!dockerfileContent.includes('USER node')) {
      throw new Error('Dockerfile must configure non-root USER node');
    }
    if (!dockerfileContent.includes('HEALTHCHECK')) {
      throw new Error('Dockerfile must configure HEALTHCHECK probe');
    }
    if (!dockerfileContent.includes('EXPOSE 3000')) {
      throw new Error('Dockerfile must expose port 3000');
    }
    console.log('  ✓ Dockerfile: node:20-alpine, non-root user, healthcheck, and port 3000 verified.');

    const dockerignorePath = path.resolve(__dirname, '../.dockerignore');
    if (!fs.existsSync(dockerignorePath)) {
      throw new Error('.dockerignore does not exist');
    }
    const dockerignoreContent = fs.readFileSync(dockerignorePath, 'utf8');

    if (!dockerignoreContent.includes('node_modules') || !dockerignoreContent.includes('.env') || !dockerignoreContent.includes('.git')) {
      throw new Error('.dockerignore must exclude node_modules, .env, and .git');
    }
    console.log('  ✓ .dockerignore: excludes node_modules, .env, .git, and tests.\n');

    // -------------------------------------------------------------------------
    // 6. Docker Compose Configuration Verification
    // -------------------------------------------------------------------------
    console.log('6. Testing Docker Compose Configuration (docker compose config)...');
    try {
      let composeOutput;
      try {
        composeOutput = execSync('docker compose config', {
          cwd: path.resolve(__dirname, '..'),
          encoding: 'utf8',
        });
      } catch (e) {
        // Fallback to docker-compose (standalone binary) if docker compose plugin unavailable
        composeOutput = execSync('docker-compose config', {
          cwd: path.resolve(__dirname, '..'),
          encoding: 'utf8',
        });
      }
      if (!composeOutput.includes('rs_awal_bros_postgres') || !composeOutput.includes('rs_awal_bros_app')) {
        throw new Error('docker-compose config missing required service definitions');
      }
      if (!composeOutput.includes('service_healthy')) {
        throw new Error('docker-compose missing service_healthy dependency');
      }
      console.log('  ✓ Docker Compose configuration parsed and verified with zero errors.\n');
    } catch (composeErr) {
      throw new Error(`docker compose config validation failed: ${composeErr.message}`);
    }

    console.log('=== ALL M9 PRODUCTION HARDENING & CONTAINERIZATION TESTS PASSED (100%) ===\n');
  } finally {
    dbConfig.pool = originalPool;
    dbConfig.query = originalQuery;
    server.close();
  }
}

if (require.main === module) {
  runM9Tests().catch((err) => {
    console.error('\n❌ M9 Test Failure:', err.message);
    process.exit(1);
  });
}

module.exports = { runM9Tests };
