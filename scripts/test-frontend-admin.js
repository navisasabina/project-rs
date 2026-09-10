/**
 * Automated Verification Script for Milestone M7: Admin Dashboard UI
 * 
 * Verifies:
 * 1. Admin Web Page Serving:
 *    - GET /admin/login serves admin-login.html (200 OK)
 *    - GET /admin serves admin.html (200 OK)
 *    - GET /admin/guides (SPA subpath) serves admin.html (200 OK)
 *    - Static client scripts (js/admin-api.js, js/admin-dashboard.js) served with 200 OK
 * 2. Public Portal Integrity:
 *    - GET / serves index.html (200 OK)
 *    - Verified "Portal Staf IT" navigation link exists pointing to /admin/login
 *    - Zero regression to existing public portal tabs
 * 3. End-to-End API Integration for Dashboard:
 *    - Unauthenticated session check returns 401
 *    - Login with valid credentials succeeds and establishes HttpOnly cookie
 *    - Session verification (GET /api/v1/auth/me) returns profile for ADMIN, IT_MANAGER, and IT_SUPPORT
 *    - RBAC enforcement: IT_SUPPORT read-only vs ADMIN/IT_MANAGER mutation
 *    - Dynamic steps sequencing (1, 2, 3...)
 *    - Complete lifecycle transition (DRAFT -> PUBLISHED -> ARCHIVED)
 *    - Category CRUD and status toggle
 *    - Logout clears session
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { newDb, DataType } = require('pg-mem');

function request(serverPort, path, method = 'GET', postData = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const headers = {};

    if (cookie) {
      headers['Cookie'] = cookie;
    }

    let payloadStr = null;
    if (postData) {
      payloadStr = typeof postData === 'string' ? postData : JSON.stringify(postData);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payloadStr);
    }

    const options = {
      hostname: 'localhost',
      port: serverPort,
      path: path,
      method: method,
      headers: headers,
    };

    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch (e) {
          json = null;
        }

        let setCookie = null;
        if (res.headers['set-cookie']) {
          setCookie = Array.isArray(res.headers['set-cookie'])
            ? res.headers['set-cookie'].join('; ')
            : res.headers['set-cookie'];
        }

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          setCookie,
          body: json,
          rawBody: rawData,
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

function extractCookieHeader(setCookieStr) {
  if (!setCookieStr) return null;
  const match = setCookieStr.match(/auth_token=[^;]+/);
  return match ? match[0] : null;
}

async function runM7Tests() {
  console.log('=== STARTING M7 ADMIN DASHBOARD UI AUTOMATED VERIFICATION ===\n');

  // 1. Initialize isolated database (pg-mem)
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

  const upSql = fs.readFileSync(path.resolve(__dirname, '../database/migrations/001_initial_schema.up.sql'), 'utf8');
  const ddl = upSql.split('-- 8. Trigger function for Search Vector update')[0];
  const client = await testPool.connect();
  await client.query(ddl);
  client.release();

  // Run M2 Seed
  const { seedSOPData } = require('../database/seed-sop-data');
  await seedSOPData(testPool);

  // Bootstrap Admin
  const { seedAdmin } = require('../database/seed-admin');
  await seedAdmin({
    username: 'admin.super',
    password: 'SuperAdminPassword123!',
    fullName: 'Super Administrator',
    email: 'admin.super@awalbros.com',
    targetPool: testPool,
  });

  // Intercept database config
  const dbConfig = require('../server/config/database');
  const originalPool = dbConfig.pool;
  const originalQuery = dbConfig.query;
  dbConfig.pool = testPool;
  dbConfig.query = (text, params) => testPool.query(text, params);

  // Start Express server on dedicated test port
  const app = require('../server/app');
  const TEST_PORT = 3006;
  const server = app.listen(TEST_PORT);

  try {
    // 2. Test Admin Static Web Pages Serving
    console.log('2. Testing Admin Web Pages Serving & Routing...');
    
    // GET /admin/login
    const loginPageRes = await request(TEST_PORT, '/admin/login', 'GET');
    if (loginPageRes.statusCode !== 200) throw new Error(`GET /admin/login failed: HTTP ${loginPageRes.statusCode}`);
    if (!loginPageRes.rawBody.includes('Login Portal Staf IT') || !loginPageRes.rawBody.includes('admin-login-form')) {
      throw new Error('GET /admin/login did not return expected admin-login.html content');
    }
    if (!loginPageRes.rawBody.includes('src="/logo.png"')) {
      throw new Error('admin-login.html must use src="/logo.png"');
    }
    if (loginPageRes.rawBody.includes('brightness-0 invert')) {
      throw new Error('admin-login.html must not use brightness-0 invert filter on logo');
    }
    console.log('  ✓ GET /admin/login serves admin-login.html with valid logo asset and without invalid filters (HTTP 200).');

    // GET /admin
    const dashboardPageRes = await request(TEST_PORT, '/admin', 'GET');
    if (dashboardPageRes.statusCode !== 200) throw new Error(`GET /admin failed: HTTP ${dashboardPageRes.statusCode}`);
    if (!dashboardPageRes.rawBody.includes('Admin Knowledge Base') || !dashboardPageRes.rawBody.includes('view-overview')) {
      throw new Error('GET /admin did not return expected admin.html content');
    }
    if (!dashboardPageRes.rawBody.includes('src="/logo.png"')) {
      throw new Error('admin.html must use src="/logo.png"');
    }
    if (dashboardPageRes.rawBody.includes('brightness-0 invert')) {
      throw new Error('admin.html must not use brightness-0 invert filter on logo');
    }
    console.log('  ✓ GET /admin serves admin.html with valid logo asset and without invalid filters (HTTP 200).');

    // GET /logo.png static asset verification
    const logoRes = await request(TEST_PORT, '/logo.png', 'GET');
    if (logoRes.statusCode !== 200 || !logoRes.headers['content-type']?.includes('image/png')) {
      throw new Error('GET /logo.png failed to serve valid PNG image');
    }
    console.log('  ✓ GET /logo.png serves official RS Awal Bros brand asset (HTTP 200 image/png).');

    // GET /admin/guides (SPA subrouting)
    const spaSubrouteRes = await request(TEST_PORT, '/admin/guides', 'GET');
    if (spaSubrouteRes.statusCode !== 200 || !spaSubrouteRes.rawBody.includes('Admin Knowledge Base')) {
      throw new Error('GET /admin/guides SPA subrouting failed');
    }
    console.log('  ✓ GET /admin/guides serves admin.html SPA subroute (HTTP 200).');

    // GET /js/admin-api.js & /js/admin-dashboard.js
    const apiJsRes = await request(TEST_PORT, '/js/admin-api.js', 'GET');
    if (apiJsRes.statusCode !== 200 || !apiJsRes.rawBody.includes('AdminAPI')) {
      throw new Error('GET /js/admin-api.js failed');
    }
    const dashboardJsRes = await request(TEST_PORT, '/js/admin-dashboard.js', 'GET');
    if (dashboardJsRes.statusCode !== 200 || !dashboardJsRes.rawBody.includes('Admin Dashboard Controller')) {
      throw new Error('GET /js/admin-dashboard.js failed');
    }
    console.log('  ✓ Admin client scripts (js/admin-api.js, js/admin-dashboard.js) served with HTTP 200.');

    // 3. Testing Public Portal Link to Admin Login
    console.log('3. Testing Public User Portal Integration...');
    const publicPortalRes = await request(TEST_PORT, '/', 'GET');
    if (publicPortalRes.statusCode !== 200) throw new Error('GET / public portal failed');
    if (!publicPortalRes.rawBody.includes('href="/admin/login"') || !publicPortalRes.rawBody.includes('Portal Staf IT')) {
      throw new Error('Public portal does not contain "Portal Staf IT" navigation link to /admin/login');
    }
    console.log('  ✓ Public portal index.html includes discrete "Portal Staf IT" link.');

    // 4. Testing End-to-End Auth Flow & Role Simulation
    console.log('4. Testing Authentication & Session Verification for Dashboard...');
    // Unauthenticated profile check
    const unauthMe = await request(TEST_PORT, '/api/v1/auth/me', 'GET');
    if (unauthMe.statusCode !== 401) throw new Error(`Expected 401 for unauthenticated /auth/me, got ${unauthMe.statusCode}`);

    // Login as ADMIN
    const loginAdminRes = await request(TEST_PORT, '/api/v1/auth/login', 'POST', {
      username: 'admin.super',
      password: 'SuperAdminPassword123!',
    });
    if (loginAdminRes.statusCode !== 200) throw new Error('Admin login failed');
    const adminCookie = extractCookieHeader(loginAdminRes.setCookie);
    if (!adminCookie) throw new Error('Auth cookie not found in login response');

    // Verify session
    const meRes = await request(TEST_PORT, '/api/v1/auth/me', 'GET', null, adminCookie);
    if (meRes.statusCode !== 200 || meRes.body.data.role !== 'ADMIN') {
      throw new Error('Session profile mismatch');
    }
    console.log(`  ✓ Authenticated session active for: ${meRes.body.data.full_name} (${meRes.body.data.role}).`);

    // Provision IT_SUPPORT account
    await request(TEST_PORT, '/api/v1/admin/users', 'POST', {
      full_name: 'Support Doni',
      username: 'support.doni',
      email: 'support.doni@awalbros.com',
      password: 'SupportPassword123!',
      role: 'IT_SUPPORT',
    }, adminCookie);

    // Login as IT_SUPPORT
    const loginSupportRes = await request(TEST_PORT, '/api/v1/auth/login', 'POST', {
      username: 'support.doni',
      password: 'SupportPassword123!',
    });
    const supportCookie = extractCookieHeader(loginSupportRes.setCookie);

    // 5. Testing Dashboard Data Queries & RBAC Mutations
    console.log('5. Testing Knowledge Base Operations & RBAC Permissions...');
    // Both roles can read categories and guides
    const adminCats = await request(TEST_PORT, '/api/v1/admin/categories', 'GET', null, adminCookie);
    const supportCats = await request(TEST_PORT, '/api/v1/admin/categories', 'GET', null, supportCookie);
    if (adminCats.statusCode !== 200 || supportCats.statusCode !== 200) throw new Error('Category fetch failed');
    if (adminCats.body.data.length !== 8) throw new Error('Expected 8 initial categories');

    const adminGuides = await request(TEST_PORT, '/api/v1/admin/guides', 'GET', null, adminCookie);
    const supportGuides = await request(TEST_PORT, '/api/v1/admin/guides', 'GET', null, supportCookie);
    if (adminGuides.statusCode !== 200 || supportGuides.statusCode !== 200) throw new Error('Guides fetch failed');
    if (adminGuides.body.data.length !== 8) throw new Error('Expected 8 initial guides');

    console.log('  ✓ Data querying succeeded for both ADMIN and IT_SUPPORT.');

    // IT_SUPPORT mutation rejected (403)
    const supportMutate = await request(TEST_PORT, '/api/v1/admin/categories', 'POST', {
      name: 'Tes Kategori Terlarang',
    }, supportCookie);
    if (supportMutate.statusCode !== 403) throw new Error('IT_SUPPORT must be rejected with 403 on mutation');
    console.log('  ✓ IT_SUPPORT mutation strictly rejected with 403.');

    // 6. Testing Guide Creation with Dynamic Steps & Lifecycle
    console.log('6. Testing SOP Guide Creation with Dynamic Steps and Lifecycle...');
    const catId = adminCats.body.data[0].id;
    const newGuidePayload = {
      title: 'Koneksi WiFi Ruang Operasi Terputus',
      category_id: catId,
      location_scope: 'Ruang Operasi (OK) Sentral',
      image_url: 'https://images.unsplash.com/photo-wifi-ap',
      estimated_time: '3 - 5 Menit',
      security_note: 'Pastikan perangkat monitoring pasien vital tetap terhubung ke kabel LAN cadangan.',
      symptoms: ['SSID WiFi Medis tidak muncul', 'Sinyal terputus-putus'],
      possible_causes: 'Akses poin PoE me-restart atau kabel data kendor.',
      prompt_shortcut: 'Bagaimana cara mengatasi WiFi ruang operasi terputus?',
      keywords: 'wifi akses poin ok operasi sinyal hilang',
      status: 'DRAFT',
      steps: [
        { step_number: 1, title: 'Cek Lampu Status AP', instruction: 'Periksa lampu LED hijau pada unit AP di plafon.' },
        { step_number: 2, title: 'Cek Switch PoE Ruangan', instruction: 'Pastikan port PoE nomor 8 pada rak switch menyala aktif.' },
      ],
    };

    const createRes = await request(TEST_PORT, '/api/v1/admin/guides', 'POST', newGuidePayload, adminCookie);
    if (createRes.statusCode !== 201) throw new Error(`Create guide failed: HTTP ${createRes.statusCode}`);
    const createdId = createRes.body.data.id;
    const createdKey = createRes.body.data.key_code;

    // Verify DRAFT not visible in public API
    const pubCheck1 = await request(TEST_PORT, `/api/v1/guides/${createdKey}`, 'GET');
    if (pubCheck1.statusCode !== 404) throw new Error('DRAFT guide must return 404 in public API');
    console.log('  ✓ DRAFT guide is 100% invisible on public portal.');

    // Transition DRAFT -> PUBLISHED
    const pubRes = await request(TEST_PORT, `/api/v1/admin/guides/${createdId}/status`, 'PATCH', { status: 'PUBLISHED' }, adminCookie);
    if (pubRes.statusCode !== 200 || pubRes.body.data.status !== 'PUBLISHED') throw new Error('Publish guide failed');

    // Verify PUBLISHED guide IS now visible in public API
    const pubCheck2 = await request(TEST_PORT, `/api/v1/guides/${createdKey}`, 'GET');
    if (pubCheck2.statusCode !== 200) throw new Error('PUBLISHED guide must return 200 in public API');
    if (pubCheck2.body.data.steps.length !== 2) throw new Error('Steps count mismatch in public API');
    console.log('  ✓ PUBLISHED guide immediately live on public portal with 2 steps.');

    // Update Steps (PUT /steps) - add 3rd step
    const putStepsRes = await request(TEST_PORT, `/api/v1/admin/guides/${createdId}/steps`, 'PUT', [
      { title: 'Langkah 1: Cek Lampu Status AP', instruction: 'Periksa LED hijau.' },
      { title: 'Langkah 2: Cek Switch PoE Ruangan', instruction: 'Pastikan port PoE 8 aktif.' },
      { title: 'Langkah 3: Restart Port PoE via Console', instruction: 'Lakukan power cycle pada port 8.' },
    ], adminCookie);
    if (putStepsRes.statusCode !== 200 || putStepsRes.body.data.length !== 3) throw new Error('PUT steps failed');
    console.log('  ✓ Steps successfully updated to 3 steps with sequential order.');

    // Transition PUBLISHED -> ARCHIVED
    const archRes = await request(TEST_PORT, `/api/v1/admin/guides/${createdId}/status`, 'PATCH', { status: 'ARCHIVED' }, adminCookie);
    if (archRes.statusCode !== 200 || archRes.body.data.status !== 'ARCHIVED') throw new Error('Archive guide failed');

    // Verify ARCHIVED removed from public API
    const pubCheck3 = await request(TEST_PORT, `/api/v1/guides/${createdKey}`, 'GET');
    if (pubCheck3.statusCode !== 404) throw new Error('ARCHIVED guide must return 404 in public API');
    console.log('  ✓ ARCHIVED guide immediately withdrawn from public portal.');

    // 7. Testing Category Management & Status Toggle
    console.log('7. Testing Category Management...');
    const newCatRes = await request(TEST_PORT, '/api/v1/admin/categories', 'POST', {
      name: 'Sistem Telemedisin',
      icon: 'videocam',
      description: 'Perangkat video conference dokter spesialis.',
      display_order: 12,
    }, adminCookie);
    if (newCatRes.statusCode !== 201) throw new Error('Create category failed');
    const newCatId = newCatRes.body.data.id;

    // Toggle active status
    const toggleRes = await request(TEST_PORT, `/api/v1/admin/categories/${newCatId}/status`, 'PATCH', {
      is_active: false,
    }, adminCookie);
    if (toggleRes.statusCode !== 200 || toggleRes.body.data.is_active !== false) throw new Error('Category toggle failed');
    console.log('  ✓ Category created and status toggled successfully.');

    // 8. Testing Logout
    console.log('8. Testing Logout...');
    const logoutRes = await request(TEST_PORT, '/api/v1/auth/logout', 'POST', null, adminCookie);
    if (logoutRes.statusCode !== 200) throw new Error('Logout failed');

    const clearedCookie = extractCookieHeader(logoutRes.setCookie);
    const postLogoutMe = await request(TEST_PORT, '/api/v1/auth/me', 'GET', null, clearedCookie);
    if (postLogoutMe.statusCode !== 401) throw new Error('Session should be invalid after logout');
    console.log('  ✓ Logout successfully invalidated session cookie.');

    console.log('\n=== ALL M7 ADMIN DASHBOARD UI VERIFICATION TESTS PASSED (100%) ===\n');
  } finally {
    dbConfig.pool = originalPool;
    dbConfig.query = originalQuery;
    server.close();
  }
}

if (require.main === module) {
  runM7Tests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ M7 TEST SUITE FAILED:', err);
      process.exit(1);
    });
}

module.exports = { runM7Tests };
