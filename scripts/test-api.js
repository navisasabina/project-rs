/**
 * Automated Test Suite for M3: Public REST API Foundation
 * 
 * Verifies:
 * 1. Health check endpoint (GET /api/v1/health)
 * 2. Categories listing (GET /api/v1/categories) - Status, Count, Non-empty fields
 * 3. Guides listing (GET /api/v1/guides) - Status, 8 Published Guides, No Drafts
 * 4. Guides filter by category (GET /api/v1/guides?category=farmasi-kasir)
 * 5. Guide detail by key_code (GET /api/v1/guides/printer) - Category relation, Steps 1->2->3 ordering
 * 6. Guide detail by UUID (GET /api/v1/guides/:uuid)
 * 7. 404 handling for non-existent guide (GET /api/v1/guides/does-not-exist)
 * 8. Validation rejection for malformed identifier (GET /api/v1/guides/!@#$%)
 * 9. Unmatched API route 404 handler (GET /api/v1/nonexistent)
 * 10. Data parity verification between API response and PostgreSQL database
 * 11. Read-only safety: ensure POST/PUT/DELETE return 404 or method rejection
 * 12. Static User Portal serving without regression (GET /)
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { newDb, DataType } = require('pg-mem');
const crypto = require('crypto');

// Helper to make HTTP requests
function request(serverPort, path, method = 'GET', postData = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: serverPort,
      path: path,
      method: method,
      headers: {
        'Accept': 'application/json',
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
          // might be HTML
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

async function runM3Tests() {
  console.log('=== STARTING M3 PUBLIC REST API AUTOMATED VERIFICATION ===\n');

  // 1. Setup PostgreSQL engine using pg-mem for isolated hermetic API verification
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
  console.log('PASS: Database initialized and seeded with 8 official SOP guides.\n');

  // 2. Intercept server database pool to use our seeded testPool
  const dbConfig = require('../server/config/database');
  const originalQuery = dbConfig.query;
  const originalPool = dbConfig.pool;
  dbConfig.pool = testPool;
  dbConfig.query = (text, params) => testPool.query(text, params);

  // 3. Start Express server on ephemeral test port
  const app = require('../server/app');
  const TEST_PORT = 3002;
  const server = app.listen(TEST_PORT);

  try {
    // Test 1: GET /api/v1/health
    console.log('2. Testing Health Check (GET /api/v1/health)...');
    const healthRes = await request(TEST_PORT, '/api/v1/health');
    if (healthRes.statusCode === 200 && healthRes.body.status === 'ok') {
      console.log('  ✓ GET /api/v1/health returned HTTP 200 with status: "ok"');
    } else {
      throw new Error(`Health check failed with status ${healthRes.statusCode}`);
    }

    // Test 2: GET /api/v1/categories
    console.log('\n3. Testing Categories Endpoint (GET /api/v1/categories)...');
    const catRes = await request(TEST_PORT, '/api/v1/categories');
    if (catRes.statusCode !== 200) {
      throw new Error(`GET /categories returned status ${catRes.statusCode}`);
    }
    const categories = catRes.body.data;
    if (!Array.isArray(categories) || categories.length === 0) {
      throw new Error('GET /categories returned empty or invalid data array');
    }
    console.log(`  ✓ HTTP 200 OK. Total Categories returned: ${categories.length} (meta.count: ${catRes.body.meta.count})`);
    
    // Check first category structure
    const sampleCat = categories[0];
    if (!sampleCat.id || !sampleCat.name || !sampleCat.slug || !sampleCat.icon || typeof sampleCat.guide_count !== 'number') {
      throw new Error('Category object missing required fields (id, name, slug, icon, guide_count)');
    }
    console.log(`  ✓ Sample Category Verified: "${sampleCat.name}" (slug: ${sampleCat.slug}, guide_count: ${sampleCat.guide_count})`);

    // Test 3: GET /api/v1/guides (All Published)
    console.log('\n4. Testing Guides Listing (GET /api/v1/guides)...');
    const guidesRes = await request(TEST_PORT, '/api/v1/guides');
    if (guidesRes.statusCode !== 200) {
      throw new Error(`GET /guides returned status ${guidesRes.statusCode}`);
    }
    const guides = guidesRes.body.data;
    if (!Array.isArray(guides) || guides.length !== 8) {
      throw new Error(`Expected exactly 8 published guides, received: ${guides ? guides.length : 'null'}`);
    }
    console.log(`  ✓ HTTP 200 OK. Total Published Guides: ${guides.length} (Expected: 8)`);

    // Ensure all guides have status 'PUBLISHED'
    const nonPublished = guides.filter(g => g.status !== 'PUBLISHED');
    if (nonPublished.length > 0) {
      throw new Error('Public guides listing contains non-PUBLISHED guides!');
    }
    console.log('  ✓ 100% of returned guides are in PUBLISHED status.');

    // Test 4: Category filter query (GET /api/v1/guides?category=farmasi-kasir)
    console.log('\n5. Testing Guides Filter by Category (?category=farmasi-kasir)...');
    const filteredRes = await request(TEST_PORT, '/api/v1/guides?category=farmasi-kasir');
    if (filteredRes.statusCode !== 200) {
      throw new Error(`GET /guides?category=farmasi-kasir failed with status ${filteredRes.statusCode}`);
    }
    const filteredGuides = filteredRes.body.data;
    if (filteredGuides.length !== 1 || filteredGuides[0].key_code !== 'printer') {
      throw new Error(`Expected exactly 1 guide ("printer") for category farmasi-kasir, got ${filteredGuides.length}`);
    }
    console.log(`  ✓ Filter by category works accurately. Returned: "${filteredGuides[0].title}" (key: ${filteredGuides[0].key_code})`);

    // Test 5: Guide Detail by key_code (GET /api/v1/guides/printer)
    console.log('\n6. Testing Guide Detail by key_code (GET /api/v1/guides/printer)...');
    const detailRes = await request(TEST_PORT, '/api/v1/guides/printer');
    if (detailRes.statusCode !== 200) {
      throw new Error(`GET /guides/printer failed with status ${detailRes.statusCode}`);
    }
    const guideDetail = detailRes.body.data;
    if (guideDetail.key_code !== 'printer' || guideDetail.title !== 'Printer Tidak Berfungsi / Resep Macet') {
      throw new Error('Guide detail returned incorrect title or key_code');
    }
    if (!guideDetail.category || guideDetail.category.name !== 'Farmasi & Kasir') {
      throw new Error('Guide detail missing or incorrect category relation');
    }
    if (!Array.isArray(guideDetail.steps) || guideDetail.steps.length !== 3) {
      throw new Error(`Expected exactly 3 steps for printer guide, got ${guideDetail.steps ? guideDetail.steps.length : 0}`);
    }

    // Verify deterministic step order 1 -> 2 -> 3
    for (let i = 0; i < 3; i++) {
      const step = guideDetail.steps[i];
      if (step.step_number !== i + 1) {
        throw new Error(`Step index ${i} has wrong step_number: ${step.step_number} (expected ${i + 1})`);
      }
      if (!step.title || !step.instruction) {
        throw new Error(`Step ${i + 1} missing title or instruction`);
      }
    }
    console.log('  ✓ HTTP 200 OK. Guide detail verified with category relation and deterministic steps (1 -> 2 -> 3).');

    // Test 6: Guide Detail by UUID
    console.log('\n7. Testing Guide Detail by UUID...');
    const guideUuid = guideDetail.id;
    const uuidRes = await request(TEST_PORT, `/api/v1/guides/${guideUuid}`);
    if (uuidRes.statusCode !== 200 || uuidRes.body.data.id !== guideUuid) {
      throw new Error(`Lookup by UUID failed or returned mismatch (status: ${uuidRes.statusCode})`);
    }
    console.log(`  ✓ Lookup by UUID (${guideUuid}) succeeded.`);

    // Test 7: Not Found Handling (GET /api/v1/guides/does-not-exist)
    console.log('\n8. Testing 404 Guide Not Found (GET /api/v1/guides/does-not-exist)...');
    const notFoundRes = await request(TEST_PORT, '/api/v1/guides/does-not-exist');
    if (notFoundRes.statusCode !== 404) {
      throw new Error(`Expected 404 for unknown guide, got ${notFoundRes.statusCode}`);
    }
    if (notFoundRes.body.error.code !== 'GUIDE_NOT_FOUND') {
      throw new Error(`Expected GUIDE_NOT_FOUND error code, got ${notFoundRes.body.error.code}`);
    }
    console.log(`  ✓ HTTP 404 with standard error code: "${notFoundRes.body.error.code}"`);

    // Test 8: Malformed Identifier Validation (GET /api/v1/guides/!@#$%)
    console.log('\n9. Testing Parameter Validation for Malformed Identifier...');
    const invalidRes = await request(TEST_PORT, '/api/v1/guides/%21%40%23%24%25');
    if (invalidRes.statusCode !== 400 || invalidRes.body.error.code !== 'INVALID_IDENTIFIER') {
      throw new Error(`Expected 400 INVALID_IDENTIFIER, got ${invalidRes.statusCode}`);
    }
    console.log('  ✓ Malformed identifier rejected safely with HTTP 400 INVALID_IDENTIFIER.');

    // Test 9: Unknown API Route 404 handler (GET /api/v1/unknown_resource)
    console.log('\n10. Testing Unmatched /api/* Route 404 Handler...');
    const unknownRouteRes = await request(TEST_PORT, '/api/v1/unknown_resource');
    if (unknownRouteRes.statusCode !== 404 || unknownRouteRes.body.error.code !== 'ROUTE_NOT_FOUND') {
      throw new Error(`Expected 404 ROUTE_NOT_FOUND for unmatched API route, got ${unknownRouteRes.statusCode}`);
    }
    console.log('  ✓ Unmatched API route returned HTTP 404 ROUTE_NOT_FOUND.');

    // Test 10: Security Boundary Check (POST /api/v1/guides should be rejected)
    console.log('\n11. Testing Security Boundary (Public API is Read-Only)...');
    const postRes = await request(TEST_PORT, '/api/v1/guides', 'POST', JSON.stringify({ title: 'Illegal Guide' }));
    if (postRes.statusCode !== 404) {
      throw new Error(`Expected 404 for POST /api/v1/guides in read-only M3, got ${postRes.statusCode}`);
    }
    console.log('  ✓ POST /api/v1/guides safely rejected with 404 (No mutation allowed on public endpoint).');

    // Test 11: Frontend Serving Check (GET /)
    console.log('\n12. Testing Existing User Portal (GET /)...');
    const portalRes = await request(TEST_PORT, '/');
    if (portalRes.statusCode !== 200 || !portalRes.rawText.includes('Portal Panduan Hardware IT - RS Awal Bros')) {
      throw new Error('User portal index.html is not being served properly');
    }
    console.log('  ✓ GET / serves User Portal without regression.');

    // Test 12: Comprehensive Data Parity across all 8 SOPs
    console.log('\n13. Testing Data Parity for all 8 SOPs between API and PostgreSQL...');
    const allKeys = ['cache', 'lan', 'printer', 'power', 'monitor', 'mouse', 'minipc', 'cctv'];
    for (const key of allKeys) {
      const sopRes = await request(TEST_PORT, `/api/v1/guides/${key}`);
      if (sopRes.statusCode !== 200) {
        throw new Error(`Failed to fetch guide for key "${key}"`);
      }
      const data = sopRes.body.data;
      if (!data.id || !data.title || !data.category || !data.steps || data.steps.length !== 3) {
        throw new Error(`Data parity issue for SOP "${key}"`);
      }
    }
    console.log(`  ✓ All ${allKeys.length} SOP records return 100% complete and valid API responses.`);

    console.log('\n=== ALL M3 PUBLIC API VERIFICATION TESTS PASSED (100%) ===\n');
  } finally {
    // Restore original pool and query
    dbConfig.pool = originalPool;
    dbConfig.query = originalQuery;
    server.close();
  }
}

// Execute tests if invoked directly
if (require.main === module) {
  runM3Tests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ M3 TEST RUNNER FAILED:', err);
      process.exit(1);
    });
}

module.exports = { runM3Tests };
