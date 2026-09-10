/**
 * Automated Verification Script for Milestone M11:
 * Observability, Centralized Error Handling & Operational Diagnostics
 * 
 * Verifies:
 * 1. Generated X-Request-Id (UUID v4)
 * 2. Supplied X-Request-Id handling & sanitization of malformed IDs
 * 3. Request ID response header across all HTTP status codes
 * 4. Malformed JSON payload -> HTTP 400 INVALID_JSON_PAYLOAD
 * 5. Unexpected server error -> HTTP 500 INTERNAL_SERVER_ERROR
 * 6. No stack trace, SQL, or internal filesystem path leakage
 * 7. Zero HTML error pages on API endpoints (strictly JSON)
 * 8. Centralized structured logger output (JSON in production)
 * 9. Automated recursive secret redaction (passwords, JWTs, tokens, cookies, API keys)
 * 10. Health endpoint backward compatibility (/api/v1/health)
 * 11. Health diagnostics (uptime in seconds and memory usage summary in MB)
 * 12. Operational readiness endpoint contract (/api/v1/health/ready)
 * 13. Admin operational metrics authentication (/api/v1/admin/metrics -> 401 unauthenticated)
 * 14. Admin metrics RBAC (ADMIN=200, IT_MANAGER=200, IT_SUPPORT=403 FORBIDDEN_RESOURCE)
 * 15. In-memory metrics counters (uptime, requests, status families 2xx/3xx/4xx/5xx, latencies)
 * 16. Rate-limit observability & metrics counters
 * 17. AI diagnostics observability (safety refusals & DB-grounded fallbacks)
 * 18. Search latency measurement and counters
 * 19. Docker Compose environment interpolation for GEMINI_API_KEY
 * 20. Zero external dependencies added & full regression
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { newDb, DataType } = require('pg-mem');

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeRequest(serverPort, reqPath, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      Accept: 'application/json',
      ...headers,
    };

    let payloadStr = null;
    if (data !== null) {
      if (typeof data === 'string') {
        payloadStr = data;
      } else {
        payloadStr = JSON.stringify(data);
        if (!defaultHeaders['Content-Type']) {
          defaultHeaders['Content-Type'] = 'application/json';
        }
      }
      defaultHeaders['Content-Length'] = Buffer.byteLength(payloadStr);
    }

    const options = {
      hostname: 'localhost',
      port: serverPort,
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

    if (payloadStr) {
      req.write(payloadStr);
    }
    req.end();
  });
}

function extractCookieHeader(setCookieHeader) {
  if (!setCookieHeader) return '';
  if (Array.isArray(setCookieHeader)) {
    return setCookieHeader.map((c) => c.split(';')[0]).join('; ');
  }
  return setCookieHeader.split(';')[0];
}

async function runM11Tests() {
  console.log('===============================================================');
  console.log('=== STARTING M11 OBSERVABILITY & ERROR HANDLING TEST SUITE ===');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, testName, detail = '') {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] ${testName} ${detail ? '- ' + detail : ''}`);
      throw new Error(`Assertion failed: ${testName} ${detail}`);
    }
  }

  // -------------------------------------------------------------
  // 1. Setup Isolated Hermetic Database Engine with pg-mem
  // -------------------------------------------------------------
  console.log('1. Setting up isolated in-memory PostgreSQL test database...');
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

  // Run schema migration UP
  const upSql = fs.readFileSync(path.resolve(__dirname, '../database/migrations/001_initial_schema.up.sql'), 'utf8');
  const ddl = upSql.split('-- 8. Trigger function for Search Vector update')[0];
  const client = await testPool.connect();
  await client.query(ddl);
  client.release();

  // Seed SOP data
  const { seedSOPData } = require('../database/seed-sop-data');
  await seedSOPData(testPool);

  // Seed Admin Accounts
  const { seedAdmin } = require('../database/seed-admin');
  await seedAdmin({
    username: 'admin.super',
    password: 'SuperAdminPassword123!',
    fullName: 'Super Administrator',
    email: 'admin.super@rsawalbros.com',
    targetPool: testPool,
  });

  // Provision additional roles for RBAC verification
  const bcrypt = require('bcryptjs');
  const managerHash = await bcrypt.hash('ManagerPassword123!', 10);
  const staffHash = await bcrypt.hash('StaffPassword123!', 10);

  await testPool.query(`
    INSERT INTO users (username, password_hash, full_name, email, role, is_active)
    VALUES 
      ('manager.budi', $1, 'Budi Manager IT', 'budi.manager@rsawalbros.com', 'IT_MANAGER', true),
      ('staff.it', $2, 'Staff Support', 'staff.it@rsawalbros.com', 'IT_SUPPORT', true);
  `, [managerHash, staffHash]);

  // Patch DB pool
  const dbConfig = require('../server/config/database');
  const originalPool = dbConfig.pool;
  const originalQuery = dbConfig.query;
  dbConfig.pool = testPool;
  dbConfig.query = (text, params) => testPool.query(text, params);

  // Set test environment so test helper routes are enabled
  process.env.NODE_ENV = 'test';

  // Require server components
  const app = require('../server/app');
  const logger = require('../server/utils/logger');
  const metrics = require('../server/utils/metrics');
  const { loginRateLimiter, aiRateLimiter } = require('../server/middleware/rate-limiter');

  // Reset rate limiters and metrics for a fresh start
  loginRateLimiter.reset();
  aiRateLimiter.reset();
  metrics.reset();

  // Start test server
  const TEST_PORT = 3011;
  const server = app.listen(TEST_PORT);

  try {
    console.log('\n2. Verifying Request Correlation ID & Middleware...');

    // Test 1: Generated X-Request-Id
    const res1 = await makeRequest(TEST_PORT, '/api/v1/health');
    assert(res1.statusCode === 200, 'Health endpoint responds with 200');
    assert(Boolean(res1.headers['x-request-id']), 'Response includes X-Request-Id header');
    assert(UUID_V4_REGEX.test(res1.headers['x-request-id']), 'Generated X-Request-Id is a valid UUID v4', res1.headers['x-request-id']);

    // Test 2: Supplied valid X-Request-Id is preserved
    const customId = 'req-awal-bros-trace-123456';
    const res2 = await makeRequest(TEST_PORT, '/api/v1/health', 'GET', null, {
      'X-Request-Id': customId,
    });
    assert(res2.headers['x-request-id'] === customId, 'Valid client-supplied X-Request-Id is preserved', res2.headers['x-request-id']);

    // Test 3: Malformed or unsafe X-Request-Id is safely sanitized / replaced with UUID v4
    const unsafeId = '<script>alert("xss")</script>';
    const res3 = await makeRequest(TEST_PORT, '/api/v1/health', 'GET', null, {
      'X-Request-Id': unsafeId,
    });
    assert(res3.headers['x-request-id'] !== unsafeId, 'Unsafe X-Request-Id with script tags is rejected');
    assert(UUID_V4_REGEX.test(res3.headers['x-request-id']), 'Unsafe X-Request-Id is replaced by generated UUID v4', res3.headers['x-request-id']);

    // Oversized X-Request-Id (> 64 chars) is also replaced
    const oversizedId = 'a'.repeat(128);
    const res3b = await makeRequest(TEST_PORT, '/api/v1/health', 'GET', null, {
      'X-Request-Id': oversizedId,
    });
    assert(res3b.headers['x-request-id'] !== oversizedId, 'Oversized X-Request-Id (>64 chars) is rejected');
    assert(UUID_V4_REGEX.test(res3b.headers['x-request-id']), 'Oversized X-Request-Id is replaced with UUID v4');

    console.log('\n3. Verifying Global Centralized Error Handling & JSON Safety...');

    // Test 4: Malformed JSON body returns HTTP 400 INVALID_JSON_PAYLOAD
    const resMalformed = await makeRequest(
      TEST_PORT,
      '/api/v1/auth/login',
      'POST',
      '{"username": "admin", "password": bad_unquoted_json}',
      { 'Content-Type': 'application/json' }
    );
    assert(resMalformed.statusCode === 400, 'Malformed JSON returns HTTP 400');
    assert(resMalformed.body !== null, 'Malformed JSON returns valid JSON response (not HTML)');
    assert(resMalformed.body.success === false, 'Malformed JSON has success: false');
    assert(resMalformed.body.error.code === 'INVALID_JSON_PAYLOAD', 'Error code is INVALID_JSON_PAYLOAD', resMalformed.body.error.code);
    assert(Boolean(resMalformed.body.error.requestId), 'Error object includes requestId');
    assert(resMalformed.body.error.requestId === resMalformed.headers['x-request-id'], 'requestId in body matches X-Request-Id header');

    // Test 5 & 6: Unexpected Server Error returns HTTP 500 without leaking stack trace or paths
    const resCrash = await makeRequest(TEST_PORT, '/api/v1/test-crash-simulation');
    assert(resCrash.statusCode === 500, 'Unhandled error returns HTTP 500');
    assert(resCrash.body !== null, 'Unhandled error returns JSON');
    assert(resCrash.body.success === false, 'Unhandled error has success: false');
    assert(resCrash.body.error.code === 'INTERNAL_SERVER_ERROR', 'Error code is INTERNAL_SERVER_ERROR');
    assert(resCrash.body.error.message === 'Terjadi kesalahan internal pada server.', 'Safe generic message returned');
    assert(Boolean(resCrash.body.error.requestId), '500 error includes requestId for client tracking');

    // Leakage check
    assert(!resCrash.rawBody.includes('/var/lib/postgresql'), 'Does not leak internal filesystem path');
    assert(!resCrash.rawBody.includes('confidential_secrets'), 'Does not leak internal SQL query details');
    assert(!resCrash.rawBody.includes('at internalQuery'), 'Does not leak JavaScript stack trace');
    assert(!resCrash.rawBody.includes('node_modules'), 'Does not leak node_modules path');

    // Test 7: API 404 handler returns JSON with requestId (no HTML)
    const res404 = await makeRequest(TEST_PORT, '/api/v1/non-existent-endpoint');
    assert(res404.statusCode === 404, 'Unmatched API route returns HTTP 404');
    assert(res404.body !== null, '404 returns JSON');
    assert(res404.body.error.code === 'ROUTE_NOT_FOUND', 'Error code is ROUTE_NOT_FOUND');
    assert(Boolean(res404.body.error.requestId), '404 error includes requestId');
    assert(!res404.rawBody.includes('<!DOCTYPE html>'), '404 is not an HTML error page');

    console.log('\n4. Verifying Centralized Structured Logger & Secret Redaction...');

    // Test 8: Logger JSON formatting in production mode
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    let capturedStdout = '';
    const origStdoutWrite = process.stdout.write;
    process.stdout.write = (str) => {
      capturedStdout += str;
      return true;
    };

    logger.info('Test operational event for M11 verification', {
      requestId: 'test-req-id-7788',
      action: 'TEST_AUDIT',
      status: 'OK',
    });

    process.stdout.write = origStdoutWrite;
    process.env.NODE_ENV = oldEnv;

    const parsedLog = JSON.parse(capturedStdout.trim().split('\n').pop());
    assert(parsedLog.level === 'INFO', 'Structured log has uppercase level INFO');
    assert(parsedLog.message === 'Test operational event for M11 verification', 'Structured log has correct message');
    assert(parsedLog.requestId === 'test-req-id-7788', 'Structured log includes requestId');
    assert(Boolean(parsedLog.timestamp), 'Structured log includes ISO timestamp');
    assert(parsedLog.context.action === 'TEST_AUDIT', 'Structured log includes contextual metadata');

    // Test 9: Recursive Secret Redaction
    const dirtyData = {
      user: 'dr.andi',
      password: 'PlainSecretPassword123!',
      password_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz',
      credentials: {
        jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        auth_token: 'secret_token_123',
        cookie: 'auth_token=super_secret_cookie',
        authorization: 'Bearer header_secret_token',
      },
      integrations: [
        { provider: 'Google', gemini_api_key: 'AIzaSySecretApiKey123' },
        { provider: 'Internal', secret: 'internal-secret-token' },
      ],
      safe_metric: 42,
    };

    const cleanData = logger.redact(dirtyData);
    assert(cleanData.user === 'dr.andi', 'Safe field user is preserved');
    assert(cleanData.safe_metric === 42, 'Safe field safe_metric is preserved');
    assert(cleanData.password === '[REDACTED]', 'password is redacted');
    assert(cleanData.password_hash === '[REDACTED]', 'password_hash is redacted');
    assert(cleanData.credentials.jwt === '[REDACTED]', 'Nested jwt is redacted');
    assert(cleanData.credentials.auth_token === '[REDACTED]', 'Nested auth_token is redacted');
    assert(cleanData.credentials.cookie === '[REDACTED]', 'Nested cookie is redacted');
    assert(cleanData.credentials.authorization === '[REDACTED]', 'Nested authorization is redacted');
    assert(cleanData.integrations[0].gemini_api_key === '[REDACTED]', 'Array object gemini_api_key is redacted');
    assert(cleanData.integrations[1].secret === '[REDACTED]', 'Array object secret is redacted');

    console.log('\n5. Verifying Health & Readiness Diagnostics...');

    // Test 10 & 11: Health endpoint diagnostics (uptime & memory)
    const resHealth = await makeRequest(TEST_PORT, '/api/v1/health');
    assert(resHealth.statusCode === 200, 'Health endpoint responds with 200');
    assert(resHealth.body.status === 'ok', 'Health status is ok');
    assert(resHealth.body.environment !== undefined, 'Health includes environment');
    assert(resHealth.body.timestamp !== undefined, 'Health includes timestamp');
    assert(typeof resHealth.body.uptime === 'number' && resHealth.body.uptime >= 0, 'Health includes non-negative uptime');
    assert(resHealth.body.memory !== undefined, 'Health includes memory diagnostics');
    assert(typeof resHealth.body.memory.heapUsedMb === 'number', 'Health includes numeric heapUsedMb');
    assert(typeof resHealth.body.memory.heapTotalMb === 'number', 'Health includes numeric heapTotalMb');
    assert(typeof resHealth.body.memory.rssMb === 'number', 'Health includes numeric rssMb');

    // Test 12: Readiness endpoint compatibility
    const resReady = await makeRequest(TEST_PORT, '/api/v1/health/ready');
    assert(resReady.statusCode === 200, 'Readiness probe returns 200 when database connected');
    assert(resReady.body.database === 'connected', 'Readiness body indicates database connected');

    // Simulate database failure for readiness check
    dbConfig.query = () => Promise.reject(new Error('Connection terminated unexpectedly'));
    const resReadyFail = await makeRequest(TEST_PORT, '/api/v1/health/ready');
    assert(resReadyFail.statusCode === 503, 'Readiness probe returns 503 when database is unavailable');
    assert(resReadyFail.body.database === 'disconnected', 'Readiness body indicates database disconnected');
    assert(resReadyFail.body.status === 'unhealthy', 'Readiness body indicates unhealthy status');
    // Restore dbConfig.query
    dbConfig.query = (text, params) => testPool.query(text, params);

    console.log('\n6. Verifying Admin Operational Metrics & RBAC...');

    // Test 13: Unauthenticated access to /api/v1/admin/metrics returns 401
    const resMetricsUnauth = await makeRequest(TEST_PORT, '/api/v1/admin/metrics');
    assert(resMetricsUnauth.statusCode === 401, 'Unauthenticated metrics request returns HTTP 401');

    // Login as ADMIN
    const loginAdminRes = await makeRequest(TEST_PORT, '/api/v1/auth/login', 'POST', {
      username: 'admin.super',
      password: 'SuperAdminPassword123!',
    });
    assert(loginAdminRes.statusCode === 200, 'ADMIN login successful');
    const adminCookie = extractCookieHeader(loginAdminRes.headers['set-cookie']);

    // Login as IT_MANAGER
    const loginManagerRes = await makeRequest(TEST_PORT, '/api/v1/auth/login', 'POST', {
      username: 'manager.budi',
      password: 'ManagerPassword123!',
    });
    assert(loginManagerRes.statusCode === 200, 'IT_MANAGER login successful');
    const managerCookie = extractCookieHeader(loginManagerRes.headers['set-cookie']);

    // Login as IT_SUPPORT
    const loginStaffRes = await makeRequest(TEST_PORT, '/api/v1/auth/login', 'POST', {
      username: 'staff.it',
      password: 'StaffPassword123!',
    });
    assert(loginStaffRes.statusCode === 200, 'IT_SUPPORT login successful');
    const staffCookie = extractCookieHeader(loginStaffRes.headers['set-cookie']);

    // Test 14: RBAC on /api/v1/admin/metrics
    // IT_SUPPORT gets 403 FORBIDDEN_RESOURCE
    const resMetricsStaff = await makeRequest(TEST_PORT, '/api/v1/admin/metrics', 'GET', null, {
      Cookie: staffCookie,
    });
    assert(resMetricsStaff.statusCode === 403, 'IT_SUPPORT is forbidden from viewing metrics (HTTP 403)');
    assert(resMetricsStaff.body.error.code === 'FORBIDDEN_RESOURCE', 'Error code is FORBIDDEN_RESOURCE');

    // IT_MANAGER gets 200
    const resMetricsManager = await makeRequest(TEST_PORT, '/api/v1/admin/metrics', 'GET', null, {
      Cookie: managerCookie,
    });
    assert(resMetricsManager.statusCode === 200, 'IT_MANAGER is permitted to view metrics (HTTP 200)');

    // ADMIN gets 200
    const resMetricsAdmin = await makeRequest(TEST_PORT, '/api/v1/admin/metrics', 'GET', null, {
      Cookie: adminCookie,
    });
    assert(resMetricsAdmin.statusCode === 200, 'ADMIN is permitted to view metrics (HTTP 200)');
    assert(resMetricsAdmin.body.success === true, 'Metrics response success: true');

    // Test 15: Validate metrics structure & values
    const metricsData = resMetricsAdmin.body.data;
    assert(metricsData.process !== undefined, 'Metrics snapshot includes process section');
    assert(metricsData.http !== undefined, 'Metrics snapshot includes http section');
    assert(metricsData.rate_limits !== undefined, 'Metrics snapshot includes rate_limits section');
    assert(metricsData.ai_diagnostics !== undefined, 'Metrics snapshot includes ai_diagnostics section');
    assert(metricsData.search !== undefined, 'Metrics snapshot includes search section');
    assert(metricsData.database !== undefined, 'Metrics snapshot includes database section');

    assert(metricsData.http.total_requests > 0, 'HTTP total requests counter is tracking (> 0)');
    assert(metricsData.http.status_families['2xx'] > 0, '2xx status family counter is tracking (> 0)');
    assert(metricsData.http.status_families['4xx'] > 0, '4xx status family counter is tracking (> 0)');

    console.log('\n7. Verifying Rate-Limit Observability...');

    // Test 16: Exceed login rate limit to verify metric increment
    const initialLoginRateLimitCount = metrics.getSnapshot().rate_limits.login_rate_limits_total;
    // loginRateLimiter is configured for 10 max attempts per 15 min
    for (let i = 0; i < 11; i++) {
      await makeRequest(TEST_PORT, '/api/v1/auth/login', 'POST', {
        username: 'nonexistent_brute_test',
        password: 'WrongPassword!',
      }, {
        'X-Forwarded-For': '192.168.1.55', // isolated IP
      });
    }
    const updatedLoginRateLimitCount = metrics.getSnapshot().rate_limits.login_rate_limits_total;
    assert(
      updatedLoginRateLimitCount > initialLoginRateLimitCount,
      'Login rate limit events increment metrics counter',
      `Before: ${initialLoginRateLimitCount}, After: ${updatedLoginRateLimitCount}`
    );

    console.log('\n8. Verifying AI & Search Telemetry Instrumentation...');

    // Test 17: AI Diagnostics events
    const initialAiRequests = metrics.getSnapshot().ai_diagnostics.total_ai_requests;
    const initialSafetyRefusals = metrics.getSnapshot().ai_diagnostics.safety_refusals;
    const initialDbGrounded = metrics.getSnapshot().ai_diagnostics.db_grounded_fallbacks;

    // A. Clinical Safety Refusal Query
    const resClinical = await makeRequest(TEST_PORT, '/api/v1/ai/diagnose', 'POST', {
      message: 'pasien IGD butuh obat amoxicillin dan paracetamol dosis berapa?',
    });
    assert(resClinical.statusCode === 200, 'Clinical query returns HTTP 200');
    assert(resClinical.body.data.source === 'SAFETY_REFUSAL', 'Source is SAFETY_REFUSAL');
    assert(
      metrics.getSnapshot().ai_diagnostics.safety_refusals === initialSafetyRefusals + 1,
      'safety_refusals metric increments on medical refusal'
    );

    // B. IT Hardware Troubleshooting with local PostgreSQL SOP fallback
    const resSop = await makeRequest(TEST_PORT, '/api/v1/ai/diagnose', 'POST', {
      message: 'printer farmasi botania paper jam dan tidak bisa print tiket resep',
    });
    assert(resSop.statusCode === 200, 'IT Hardware query returns HTTP 200');
    assert(resSop.body.data.source === 'DATABASE_SOP_GROUNDED', 'Falls back gracefully to DATABASE_SOP_GROUNDED');
    assert(
      metrics.getSnapshot().ai_diagnostics.db_grounded_fallbacks === initialDbGrounded + 1,
      'db_grounded_fallbacks metric increments on missing/dummy Gemini API key'
    );
    assert(
      metrics.getSnapshot().ai_diagnostics.total_ai_requests === initialAiRequests + 2,
      'total_ai_requests metric tracks each diagnostic call'
    );

    // Test 18: Search latency instrumentation
    const initialSearches = metrics.getSnapshot().search.total_searches;
    const resSearch = await makeRequest(TEST_PORT, '/api/v1/guides?search=printer');
    assert(resSearch.statusCode === 200, 'Search guides returns HTTP 200');
    const updatedSearches = metrics.getSnapshot().search.total_searches;
    assert(updatedSearches === initialSearches + 1, 'Search increments total_searches metric');
    assert(
      typeof metrics.getSnapshot().search.average_search_latency_ms === 'number',
      'Search calculates average_search_latency_ms'
    );

    console.log('\n9. Verifying Docker Compose Configuration for GEMINI_API_KEY...');

    // Test 19: docker-compose.yml configuration
    const composeContent = fs.readFileSync(path.resolve(__dirname, '../docker-compose.yml'), 'utf8');
    assert(
      composeContent.includes('GEMINI_API_KEY: ${GEMINI_API_KEY:-}'),
      'docker-compose.yml interpolates GEMINI_API_KEY into app service environment'
    );
    assert(
      !composeContent.includes('AIzaSy'),
      'docker-compose.yml never hardcodes a real API key'
    );

    console.log('\n10. Verifying Zero External Runtime Dependencies...');
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    const dependencies = Object.keys(packageJson.dependencies || {});
    const approvedDeps = ['bcryptjs', 'cookie-parser', 'dotenv', 'express', 'jsonwebtoken', 'pg'];
    for (const dep of dependencies) {
      assert(approvedDeps.includes(dep), `Dependency ${dep} is in approved baseline list`);
    }
    assert(
      !dependencies.includes('winston') &&
      !dependencies.includes('bunyan') &&
      !dependencies.includes('morgan') &&
      !dependencies.includes('prom-client') &&
      !dependencies.includes('@opentelemetry/api'),
      'Zero third-party logging or metric frameworks added'
    );

    console.log('\n===============================================================');
    console.log(`=== M11 ALL VERIFICATIONS PASSED: ${passedTests}/${totalTests} TESTS SUCCESSFUL ===`);
    console.log('===============================================================\n');
  } finally {
    // Clean up
    server.close();
    dbConfig.pool = originalPool;
    dbConfig.query = originalQuery;
    testPool.end();
  }
}

if (require.main === module) {
  runM11Tests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n[FATAL] M11 Verification Failed:', err);
      process.exit(1);
    });
}

module.exports = { runM11Tests };
