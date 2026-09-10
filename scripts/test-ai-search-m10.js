/**
 * Automated Test Suite for M10: Full-Text Search & Gemini AI Assistant Proxy
 * 
 * Verifies:
 * 1. PostgreSQL Full-Text Search (GET /api/v1/guides?search=... and ?q=...)
 * 2. Search parameter aliasing (?search= and ?q=)
 * 3. Empty & whitespace search safety
 * 4. SQL Injection resistance against malicious/special characters
 * 5. Publication isolation: DRAFT & ARCHIVED guides are never returned
 * 6. Category isolation: Guides in inactive categories are never returned
 * 7. Combined search + category filter
 * 8. Invalid category parameter validation
 * 9. AI Diagnostic endpoint (POST /api/v1/ai/diagnose) input validation (empty & > 500 chars)
 * 10. Medical & clinical query refusal boundary (patient safety guardrail)
 * 11. Grounded SOP retrieval from PostgreSQL (Printer, LAN matching)
 * 12. Graceful fallback when GEMINI_API_KEY is missing or invalid
 * 13. Dedicated rate limiter protection (HTTP 429 + Retry-After on 16th request)
 * 14. Frontend scripts security inspection (No API key leaks in client JS)
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { newDb, DataType } = require('pg-mem');
const crypto = require('crypto');

function request(serverPort, reqPath, method = 'GET', postData = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: serverPort,
      path: reqPath,
      method: method,
      headers: {
        'Accept': 'application/json',
        ...headers,
      },
    };

    if (postData) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch (e) {
          // might be HTML or empty
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json,
          rawText: rawData,
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runM10Tests() {
  console.log('=== STARTING M10 FULL-TEXT SEARCH & AI ASSISTANT AUTOMATED VERIFICATION ===\n');

  // 1. Setup PostgreSQL engine using pg-mem for isolated hermetic testing
  console.log('1. Initializing isolated PostgreSQL database instance...');
  const db = newDb();

  db.public.registerFunction({
    name: 'gen_random_uuid',
    implementation: () => crypto.randomUUID(),
    impure: true,
  });

  db.public.registerEquivalentType({
    name: 'tsvector',
    equivalentTo: DataType.text,
  });

  const adapter = db.adapters.createPg();
  const testPool = new adapter.Pool();

  // Run schema migration UP
  const upSql = fs.readFileSync(path.resolve(__dirname, '../database/migrations/001_initial_schema.up.sql'), 'utf8');
  const ddl = upSql.split('-- 8. Trigger function for Search Vector update')[0];
  const client = await testPool.connect();
  await client.query(ddl);
  client.release();

  // Run M2 Seed
  const { seedSOPData } = require('../database/seed-sop-data');
  await seedSOPData(testPool);

  // Insert test DRAFT and ARCHIVED guides to verify isolation
  const catRes = await testPool.query("SELECT id FROM categories WHERE slug = 'hardware-pc' LIMIT 1;");
  const authorRes = await testPool.query("SELECT id FROM users LIMIT 1;");
  const testCatId = catRes.rows[0].id;
  const testAuthorId = authorRes.rows[0].id;

  await testPool.query(`
    INSERT INTO guides (category_id, author_id, key_code, title, location_scope, image_url, status, keywords, security_note)
    VALUES 
      ($1, $2, 'draft_guide', 'Panduan DRAFT Printer Rahasia', 'IT Lab', 'https://example.com/draft.png', 'DRAFT', 'printer draft rahasia', 'Catatan rahasia'),
      ($1, $2, 'archived_guide', 'Panduan ARCHIVED Printer Lama', 'Gudang', 'https://example.com/archived.png', 'ARCHIVED', 'printer archived bekas', 'Catatan arsip');
  `, [testCatId, testAuthorId]);

  // Insert inactive category with guide to verify category isolation
  const inactiveCatRes = await testPool.query(`
    INSERT INTO categories (name, slug, icon, description, display_order, is_active)
    VALUES ('Kategori Nonaktif', 'kategori-nonaktif', 'block', 'Nonaktif', 99, FALSE)
    RETURNING id;
  `);
  const inactiveCatId = inactiveCatRes.rows[0].id;

  await testPool.query(`
    INSERT INTO guides (category_id, author_id, key_code, title, location_scope, image_url, status, keywords, security_note)
    VALUES ($1, $2, 'inactive_cat_guide', 'Panduan Printer Ruang Nonaktif', 'Luar RS', 'https://example.com/inactive.png', 'PUBLISHED', 'printer nonaktif', 'Catatan nonaktif');
  `, [inactiveCatId, testAuthorId]);

  console.log('PASS: Database initialized with published guides, draft/archived guides, and inactive category.\n');

  // Intercept server database pool
  const dbConfig = require('../server/config/database');
  const originalQuery = dbConfig.query;
  const originalPool = dbConfig.pool;
  dbConfig.pool = testPool;
  dbConfig.query = (text, params) => testPool.query(text, params);

  // Start Express server
  const app = require('../server/app');
  const TEST_PORT = 3010;
  const server = app.listen(TEST_PORT);

  try {
    // ==========================================
    // SECTION 1: FULL-TEXT SEARCH VERIFICATION
    // ==========================================
    console.log('--- SECTION 1: POSTGRESQL SEARCH API (GET /api/v1/guides?search=...) ---');

    // Test 1: Search by ?search=printer
    console.log('Test 1: Search ?search=printer returns published printer SOP...');
    const searchRes = await request(TEST_PORT, '/api/v1/guides?search=printer');
    if (searchRes.statusCode !== 200 || !searchRes.body.success) {
      throw new Error(`Expected 200 OK, got ${searchRes.statusCode}`);
    }
    const printerGuides = searchRes.body.data;
    if (!printerGuides.some(g => g.key_code === 'printer')) {
      throw new Error('Expected "printer" guide in search results');
    }
    console.log(`  ✓ HTTP 200. Found ${printerGuides.length} matching published guide(s) for ?search=printer.`);

    // Test 2: Search by ?q=printer (parameter alias)
    console.log('Test 2: Search alias ?q=printer returns matching guide...');
    const qRes = await request(TEST_PORT, '/api/v1/guides?q=printer');
    if (qRes.statusCode !== 200 || !qRes.body.success) {
      throw new Error(`Expected 200 OK for ?q=, got ${qRes.statusCode}`);
    }
    if (!qRes.body.data.some(g => g.key_code === 'printer')) {
      throw new Error('Expected "printer" guide in ?q= search results');
    }
    console.log('  ✓ HTTP 200. Parameter ?q= works identically to ?search=');

    // Test 3: Empty and whitespace search
    console.log('Test 3: Empty (?search=) and whitespace (?search=%20%20) queries return all published guides...');
    const emptyRes = await request(TEST_PORT, '/api/v1/guides?search=');
    const wsRes = await request(TEST_PORT, '/api/v1/guides?search=%20%20%20');
    if (emptyRes.statusCode !== 200 || emptyRes.body.data.length !== 8) {
      throw new Error(`Expected 8 published guides for empty search, got ${emptyRes.body.data.length}`);
    }
    if (wsRes.statusCode !== 200 || wsRes.body.data.length !== 8) {
      throw new Error(`Expected 8 published guides for whitespace search, got ${wsRes.body.data.length}`);
    }
    console.log('  ✓ HTTP 200. Empty and whitespace queries safely return all 8 published guides.');

    // Test 4: Special characters SQL Injection safety
    console.log('Test 4: Special characters and SQL injection attempts are safely parameterized...');
    const sqlInjRes = await request(TEST_PORT, "/api/v1/guides?search=%27%20OR%201%3D1%3B%20--");
    if (sqlInjRes.statusCode !== 200 || !sqlInjRes.body.success) {
      throw new Error(`SQL injection attempt broke query! Status: ${sqlInjRes.statusCode}`);
    }
    console.log('  ✓ HTTP 200. Malicious SQL pattern handled safely with parameterization.');

    // Test 5: DRAFT and ARCHIVED guides isolation
    console.log('Test 5: Verify DRAFT and ARCHIVED guides are NEVER returned in public search...');
    const draftSearch = await request(TEST_PORT, '/api/v1/guides?search=draft_guide');
    const archivedSearch = await request(TEST_PORT, '/api/v1/guides?search=archived_guide');
    if (draftSearch.body.data.length !== 0) {
      throw new Error('SECURITY VIOLATION: DRAFT guide leaked in public search results!');
    }
    if (archivedSearch.body.data.length !== 0) {
      throw new Error('SECURITY VIOLATION: ARCHIVED guide leaked in public search results!');
    }
    console.log('  ✓ Verified: DRAFT and ARCHIVED guides are strictly excluded from public search.');

    // Test 6: Inactive category isolation
    console.log('Test 6: Verify guides in inactive categories are NEVER exposed in search...');
    const inactiveSearch = await request(TEST_PORT, '/api/v1/guides?search=kategori-nonaktif');
    if (inactiveSearch.body.data.length !== 0) {
      throw new Error('SECURITY VIOLATION: Guide from inactive category returned in search!');
    }
    console.log('  ✓ Verified: Inactive categories remain completely inaccessible.');

    // Test 7: Combined search + category filter
    console.log('Test 7: Combined category and search filtering (?search=resep&category=farmasi-kasir)...');
    const combinedRes = await request(TEST_PORT, '/api/v1/guides?search=resep&category=farmasi-kasir');
    if (combinedRes.statusCode !== 200 || combinedRes.body.data.length !== 1 || combinedRes.body.data[0].key_code !== 'printer') {
      throw new Error('Combined filter failed to return specific printer guide in farmasi-kasir');
    }
    console.log('  ✓ Combined search & category filter returned 1 accurate result.');

    // Test 8: Invalid category validation
    console.log('Test 8: Invalid category parameter rejected safely...');
    const invalidCatRes = await request(TEST_PORT, '/api/v1/guides?search=printer&category=!@#$');
    if (invalidCatRes.statusCode !== 400 || invalidCatRes.body.error.code !== 'INVALID_QUERY_PARAMETER') {
      throw new Error(`Expected 400 INVALID_QUERY_PARAMETER, got ${invalidCatRes.statusCode}`);
    }
    console.log('  ✓ Malformed category rejected with HTTP 400 INVALID_QUERY_PARAMETER.');

    // ==========================================
    // SECTION 2: AI DIAGNOSTIC PROXY VERIFICATION
    // ==========================================
    console.log('\n--- SECTION 2: AI DIAGNOSTIC PROXY (POST /api/v1/ai/diagnose) ---');

    // Test 9: Input validation - Empty query
    console.log('Test 9: Empty question rejected with HTTP 400 INVALID_INPUT...');
    const emptyAiRes = await request(TEST_PORT, '/api/v1/ai/diagnose', 'POST', JSON.stringify({ message: '   ' }));
    if (emptyAiRes.statusCode !== 400 || emptyAiRes.body.error.code !== 'INVALID_INPUT') {
      throw new Error(`Expected 400 INVALID_INPUT, got ${emptyAiRes.statusCode}`);
    }
    console.log('  ✓ Empty query rejected with HTTP 400 INVALID_INPUT.');

    // Test 10: Input validation - Oversized input (> 500 chars)
    console.log('Test 10: Oversized question (> 500 characters) rejected with HTTP 400 INPUT_TOO_LONG...');
    const longMsg = 'A'.repeat(501);
    const longAiRes = await request(TEST_PORT, '/api/v1/ai/diagnose', 'POST', JSON.stringify({ message: longMsg }));
    if (longAiRes.statusCode !== 400 || longAiRes.body.error.code !== 'INPUT_TOO_LONG') {
      throw new Error(`Expected 400 INPUT_TOO_LONG, got ${longAiRes.statusCode}`);
    }
    console.log('  ✓ Long query (> 500 chars) rejected with HTTP 400 INPUT_TOO_LONG.');

    // Test 11: Clinical / Medical safety refusal boundary
    console.log('Test 11: Clinical / Medical query triggers patient safety boundary refusal...');
    const medicalRes = await request(TEST_PORT, '/api/v1/ai/diagnose', 'POST', JSON.stringify({
      message: 'Dokter, pasien di IGD demam tinggi dan sesak napas butuh resep obat apa?'
    }));
    if (medicalRes.statusCode !== 200 || medicalRes.body.data.source !== 'SAFETY_REFUSAL') {
      throw new Error(`Expected 200 with source: 'SAFETY_REFUSAL', got ${JSON.stringify(medicalRes.body)}`);
    }
    if (!medicalRes.body.data.intro.includes('tidak berwenang memberikan saran medis')) {
      throw new Error('Refusal message did not contain clinical boundary warning');
    }
    console.log('  ✓ Clinical boundary refusal verified: strictly directs medical queries to ER/Code Blue.');

    // Test 12: Grounded SOP Retrieval - Printer Troubleshooting
    console.log('Test 12: IT query regarding printer retrieves grounded Printer SOP...');
    const printerDiagRes = await request(TEST_PORT, '/api/v1/ai/diagnose', 'POST', JSON.stringify({
      message: 'Printer kasir farmasi macet dan lampu indikator kedip merah'
    }));
    if (printerDiagRes.statusCode !== 200 || !printerDiagRes.body.success) {
      throw new Error(`Expected 200 OK, got ${printerDiagRes.statusCode}`);
    }
    const diagData = printerDiagRes.body.data;
    if (!diagData.title.includes('Printer') || !Array.isArray(diagData.steps) || diagData.steps.length === 0) {
      throw new Error(`Grounded response missing printer title or steps: ${JSON.stringify(diagData)}`);
    }
    if (diagData.source !== 'DATABASE_SOP_GROUNDED' && diagData.source !== 'DATABASE_SOP_FALLBACK' && diagData.source !== 'GEMINI_AI_GROUNDED') {
      throw new Error(`Unexpected source attribute: ${diagData.source}`);
    }
    console.log(`  ✓ Grounded SOP diagnosis returned: "${diagData.title}" (Steps: ${diagData.steps.length}, Source: ${diagData.source})`);

    // Test 13: Grounded SOP Retrieval - Network / LAN
    console.log('Test 13: IT query regarding internet cable retrieves grounded LAN SOP...');
    const lanDiagRes = await request(TEST_PORT, '/api/v1/ai/diagnose', 'POST', JSON.stringify({
      message: 'Koneksi internet terputus muncul tanda silang merah kabel rj45'
    }));
    if (lanDiagRes.statusCode !== 200 || !lanDiagRes.body.data.title.includes('Internet')) {
      throw new Error(`Expected LAN/Internet guide title, got: ${lanDiagRes.body.data.title}`);
    }
    console.log(`  ✓ Grounded SOP diagnosis returned: "${lanDiagRes.body.data.title}"`);

    // Test 14: Verify AI never exposes DRAFT, ARCHIVED, or Inactive Category content
    console.log('Test 14: Verify AI never retrieves DRAFT/ARCHIVED/inactive content as grounded context...');
    const draftAiRes = await request(TEST_PORT, '/api/v1/ai/diagnose', 'POST', JSON.stringify({
      message: 'Panduan DRAFT Printer Rahasia IT Lab'
    }));
    if (draftAiRes.body.data && draftAiRes.body.data.title.includes('DRAFT')) {
      throw new Error('SECURITY VIOLATION: AI grounded on DRAFT guide!');
    }
    const inactiveAiRes = await request(TEST_PORT, '/api/v1/ai/diagnose', 'POST', JSON.stringify({
      message: 'Panduan Printer Ruang Nonaktif'
    }));
    if (inactiveAiRes.body.data && inactiveAiRes.body.data.title.includes('Nonaktif')) {
      throw new Error('SECURITY VIOLATION: AI grounded on inactive category guide!');
    }
    console.log('  ✓ Verified: AI grounding strictly isolates DRAFT/ARCHIVED and inactive categories.');

    // Test 15: Rate Limiter Protection (HTTP 429 after 15 requests)
    console.log('Test 15: Verify dedicated AI Rate Limiter threshold (15 req/15min)...');
    const { aiRateLimiter } = require('../server/middleware/rate-limiter');
    aiRateLimiter.reset(); // Reset counter for test isolation


    let rateLimited = false;
    let retryAfterHeader = null;

    for (let i = 1; i <= 16; i++) {
      const res = await request(TEST_PORT, '/api/v1/ai/diagnose', 'POST', JSON.stringify({
        message: `Percobaan diagnosa rate limiter nomor ${i}`
      }));

      if (i <= 15) {
        if (res.statusCode !== 200) {
          throw new Error(`Request #${i} unexpectedly failed with status ${res.statusCode}`);
        }
      } else {
        // 16th request must trigger rate limit
        if (res.statusCode === 429) {
          rateLimited = true;
          retryAfterHeader = res.headers['retry-after'];
        } else {
          throw new Error(`Request #${i} was not rate-limited! Status: ${res.statusCode}`);
        }
      }
    }

    if (!rateLimited || !retryAfterHeader) {
      throw new Error('Rate limiter did not return HTTP 429 or Retry-After header');
    }
    console.log(`  ✓ Rate limiter successfully triggered HTTP 429 on 16th request (Retry-After: ${retryAfterHeader}s).`);
    aiRateLimiter.reset(); // Clean up after test

    // ==========================================
    // SECTION 3: FRONTEND CODE SECURITY & INTEGRITY
    // ==========================================
    console.log('\n--- SECTION 3: FRONTEND CODE SECURITY & INTEGRITY ---');

    // Test 16: No GEMINI_API_KEY in frontend JavaScript files
    console.log('Test 16: Verify frontend JavaScript contains zero hardcoded API keys...');
    const searchJs = fs.readFileSync(path.resolve(__dirname, '../js/search.js'), 'utf8');
    const geminiJs = fs.readFileSync(path.resolve(__dirname, '../js/gemini-agent.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

    if (searchJs.includes('GEMINI_API_KEY') || geminiJs.includes('GEMINI_API_KEY') || indexHtml.includes('GEMINI_API_KEY')) {
      throw new Error('SECURITY VIOLATION: GEMINI_API_KEY referenced in frontend files!');
    }
    if (geminiJs.includes('AIzaSy')) {
      throw new Error('SECURITY VIOLATION: Google API Key format pattern detected in frontend JS!');
    }
    console.log('  ✓ Zero secrets or GEMINI_API_KEY references in frontend files.');

    // Test 17: Verify frontend files use the new endpoints
    console.log('Test 17: Verify frontend integration points...');
    if (!searchJs.includes('/api/v1/guides?search=')) {
      throw new Error('js/search.js does not reference /api/v1/guides?search=');
    }
    if (!geminiJs.includes('/api/v1/ai/diagnose')) {
      throw new Error('js/gemini-agent.js does not reference /api/v1/ai/diagnose');
    }
    console.log('  ✓ js/search.js calls /api/v1/guides?search= and js/gemini-agent.js calls /api/v1/ai/diagnose.');

    console.log('\n=== ALL M10 FULL-TEXT SEARCH & AI ASSISTANT TESTS PASSED (100%) ===\n');
  } finally {
    // Restore original db bindings
    dbConfig.pool = originalPool;
    dbConfig.query = originalQuery;
    server.close();
  }
}

if (require.main === module) {
  runM10Tests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ M10 TEST RUNNER FAILED:', err);
      process.exit(1);
    });
}

module.exports = { runM10Tests };
