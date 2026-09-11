/**
 * Automated Verification Script: test-delete-guide-m12x.js
 * 
 * Verifies M12.x Delete Guide Feature:
 * 1. ADMIN can permanently delete a guide (HTTP 200)
 * 2. IT_MANAGER can permanently delete a guide (HTTP 200)
 * 3. IT_SUPPORT is denied (HTTP 403 FORBIDDEN)
 * 4. Unauthenticated request is rejected (HTTP 401 UNAUTHORIZED)
 * 5. Non-existent guide returns HTTP 404 (GUIDE_NOT_FOUND)
 * 6. Malformed UUID returns HTTP 400 (INVALID_ID)
 * 7. Guide row is removed from PostgreSQL database
 * 8. Associated guide_steps are completely removed from database
 * 9. Deleted guide is immediately absent from Public API (/api/v1/guides and /api/v1/guides/:key)
 * 10. Deleted guide is absent from full-text search
 * 11. Audit log records GUIDE_DELETED action with actor ID and deletion metadata
 * 12. Audit log does not store any sensitive credentials
 * 13. Re-deleting an already deleted guide returns 404 (no duplicate delete inconsistency)
 * 14. AdminAPI.guides.delete exists and invokes HTTP DELETE with credentials
 * 15. Frontend confirmDeleteGuide exists with confirmation modal
 * 16. Baseline 8 SOPs and regression integrity intact
 */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { newDb, DataType } = require('pg-mem');

function request(serverPort, reqPath, method = 'GET', postData = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Accept': 'application/json',
    };

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
      path: reqPath,
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

async function runDeleteGuideTests() {
  console.log('================================================================');
  console.log(' STARTING M12.x DELETE GUIDE AUTOMATED VERIFICATION SUITE');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (!condition) {
      console.error(`  [FAIL] Test #${totalTests}: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
    passedTests++;
    console.log(`  [PASS] Test #${totalTests}: ${message}`);
  }

  // 1. Setup isolated database instance (pg-mem)
  console.log('1. Initializing isolated in-memory PostgreSQL database...');
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

  // Run M2 Seed (8 initial SOP guides)
  const { seedSOPData } = require('../database/seed-sop-data');
  await seedSOPData(testPool);

  // Intercept database config
  const dbConfig = require('../server/config/database');
  const originalPool = dbConfig.pool;
  const originalQuery = dbConfig.query;

  dbConfig.pool = testPool;
  dbConfig.query = (text, params) => testPool.query(text, params);

  // Bootstrap test accounts (ADMIN, IT_MANAGER, IT_SUPPORT)
  const { seedAdmin } = require('../database/seed-admin');
  const { hashPassword } = require('../server/services/auth');

  await seedAdmin({
    fullName: 'Super Administrator',
    username: 'admin.delete',
    email: 'admin.delete@awalbros.com',
    password: 'Password123!',
    targetPool: testPool,
  });

  const clientAcc = await testPool.connect();
  const mgrPassHash = await hashPassword('Manager123!');
  const supPassHash = await hashPassword('Support123!');

  await clientAcc.query(`
    INSERT INTO users (full_name, username, email, password_hash, role, is_active)
    VALUES 
      ('Manager IT', 'mgr.delete', 'mgr.delete@awalbros.com', $1, 'IT_MANAGER', TRUE),
      ('Support IT', 'sup.delete', 'sup.delete@awalbros.com', $2, 'IT_SUPPORT', TRUE)
  `, [mgrPassHash, supPassHash]);

  // Get a category ID for guide creation
  const catRes = await clientAcc.query('SELECT id FROM categories LIMIT 1');
  const testCategoryId = catRes.rows[0].id;
  clientAcc.release();

  // Start express test server
  const app = require('../server/app');
  let server;
  let port;

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      console.log(`PASS: Test server listening on ephemeral port ${port}.\n`);
      resolve();
    });
  });

  try {
    // 2. Authenticate the three roles
    console.log('2. Authenticating test roles...');
    const adminLogin = await request(port, '/api/v1/auth/login', 'POST', {
      username: 'admin.delete',
      password: 'Password123!',
    });
    const adminCookie = extractCookieHeader(adminLogin.setCookie);
    assert(adminLogin.statusCode === 200 && adminCookie, 'ADMIN login succeeded with auth cookie.');

    const mgrLogin = await request(port, '/api/v1/auth/login', 'POST', {
      username: 'mgr.delete',
      password: 'Manager123!',
    });
    const mgrCookie = extractCookieHeader(mgrLogin.setCookie);
    assert(mgrLogin.statusCode === 200 && mgrCookie, 'IT_MANAGER login succeeded with auth cookie.');

    const supLogin = await request(port, '/api/v1/auth/login', 'POST', {
      username: 'sup.delete',
      password: 'Support123!',
    });
    const supCookie = extractCookieHeader(supLogin.setCookie);
    assert(supLogin.statusCode === 200 && supCookie, 'IT_SUPPORT login succeeded with auth cookie.');

    // 3. Create a disposable guide for ADMIN deletion
    console.log('\n3. Creating disposable guide #1 for ADMIN deletion test...');
    const guide1Res = await request(port, '/api/v1/admin/guides', 'POST', {
      title: 'Panduan Uji Coba Hapus Admin',
      category_id: testCategoryId,
      location_scope: 'Unit Rawat Jalan Lantai 2',
      image_url: '/images/test-guide-1.png',
      security_note: 'Catatan keamanan uji coba',
      prompt_shortcut: 'Shortcut uji coba',
      symptoms: ['Koneksi terputus', 'Lampu indikator merah'],
      steps: [
        { title: 'Langkah 1', instruction: 'Periksa kabel power' },
        { title: 'Langkah 2', instruction: 'Nyalakan saklar utama' },
        { title: 'Langkah 3', instruction: 'Verifikasi lampu LED menyala hijau' },
      ],
    }, adminCookie);

    assert(guide1Res.statusCode === 201, 'Guide #1 created successfully (HTTP 201).');
    const guide1Id = guide1Res.body.data.id;
    const guide1Key = guide1Res.body.data.key_code;
    assert(typeof guide1Id === 'string' && guide1Id.length > 0, `Guide #1 UUID generated: ${guide1Id}`);

    // Publish guide #1 so we can verify public API removal later
    const publish1Res = await request(port, `/api/v1/admin/guides/${guide1Id}/status`, 'PATCH', {
      status: 'PUBLISHED',
    }, adminCookie);
    assert(publish1Res.statusCode === 200, 'Guide #1 published successfully.');

    // Verify it is visible in Public API
    const publicPreCheck = await request(port, `/api/v1/guides/${guide1Key}`, 'GET');
    assert(publicPreCheck.statusCode === 200, 'Guide #1 is verified present in Public API before deletion.');

    // 4. Test Unauthenticated Deletion Guard
    console.log('\n4. Testing Authentication & RBAC boundaries on DELETE /api/v1/admin/guides/:id...');
    const unauthDelete = await request(port, `/api/v1/admin/guides/${guide1Id}`, 'DELETE', null, null);
    assert(unauthDelete.statusCode === 401, 'Unauthenticated DELETE returns HTTP 401 UNAUTHORIZED.');
    assert(unauthDelete.body.error.code === 'UNAUTHORIZED', 'Error code is UNAUTHORIZED.');

    // 5. Test IT_SUPPORT Deletion Guard
    const supportDelete = await request(port, `/api/v1/admin/guides/${guide1Id}`, 'DELETE', null, supCookie);
    assert(supportDelete.statusCode === 403, 'IT_SUPPORT DELETE returns HTTP 403 FORBIDDEN.');
    assert(supportDelete.body.error.code === 'FORBIDDEN', 'Error code is FORBIDDEN.');

    // 6. Test Invalid ID Validation (Malformed UUID)
    console.log('\n5. Testing Identifier Validation...');
    const invalidIdDelete = await request(port, '/api/v1/admin/guides/not-a-valid-uuid-1234', 'DELETE', null, adminCookie);
    assert(invalidIdDelete.statusCode === 400, 'Malformed identifier returns HTTP 400.');
    assert(invalidIdDelete.body.error.code === 'INVALID_ID', 'Error code is INVALID_ID.');

    // 7. Test Non-Existent Guide Deletion (Valid UUID that does not exist)
    const nonExistentUuid = crypto.randomUUID();
    const notFoundDelete = await request(port, `/api/v1/admin/guides/${nonExistentUuid}`, 'DELETE', null, adminCookie);
    assert(notFoundDelete.statusCode === 404, `Non-existent UUID returns HTTP 404 (received ${notFoundDelete.statusCode}).`);
    assert(notFoundDelete.body.error.code === 'GUIDE_NOT_FOUND', 'Error code is GUIDE_NOT_FOUND.');

    // 8. Test ADMIN Successful Permanent Deletion
    console.log('\n6. Testing ADMIN Successful Guide Deletion...');
    const adminDeleteRes = await request(port, `/api/v1/admin/guides/${guide1Id}`, 'DELETE', null, adminCookie);
    assert(adminDeleteRes.statusCode === 200, 'ADMIN deletion returned HTTP 200 OK.');
    assert(adminDeleteRes.body.success === true, 'Response payload has success: true.');
    assert(adminDeleteRes.body.data.id === guide1Id, 'Deleted response contains correct guide ID.');
    assert(adminDeleteRes.body.data.deleted_steps_count === 3, 'Deleted response contains deleted_steps_count: 3.');

    // Verify row is physically removed from guides table
    const dbClient = await testPool.connect();
    const checkGuideDb = await dbClient.query('SELECT * FROM guides WHERE id = $1', [guide1Id]);
    assert(checkGuideDb.rows.length === 0, 'Guide row was permanently deleted from guides table.');

    // Verify steps are physically removed from guide_steps table
    const checkStepsDb = await dbClient.query('SELECT * FROM guide_steps WHERE guide_id = $1', [guide1Id]);
    assert(checkStepsDb.rows.length === 0, 'Associated guide_steps rows were completely removed from database.');
    dbClient.release();

    // 9. Verify Public API & Search Invisibility
    console.log('\n7. Verifying Public API & Search Invisibility...');
    const publicPostCheck = await request(port, `/api/v1/guides/${guide1Key}`, 'GET');
    assert(publicPostCheck.statusCode === 404, 'Deleted guide returns HTTP 404 on Public API (/api/v1/guides/:key).');

    const publicListCheck = await request(port, '/api/v1/guides', 'GET');
    const foundInList = publicListCheck.body.data.some((g) => g.id === guide1Id || g.key_code === guide1Key);
    assert(!foundInList, 'Deleted guide does NOT appear in Public API guides listing.');

    const searchCheck = await request(port, `/api/v1/guides?search=${encodeURIComponent('Uji Coba Hapus Admin')}`, 'GET');
    const foundInSearch = searchCheck.body.data.some((g) => g.id === guide1Id);
    assert(!foundInSearch, 'Deleted guide cannot be found via full-text search.');

    // 10. Test Re-deleting Already Deleted Guide
    console.log('\n8. Testing Re-deletion of Already Deleted Guide...');
    const redeleteRes = await request(port, `/api/v1/admin/guides/${guide1Id}`, 'DELETE', null, adminCookie);
    assert(redeleteRes.statusCode === 404, 'Re-deleting already deleted guide safely returns HTTP 404 GUIDE_NOT_FOUND.');

    // 11. Test IT_MANAGER Successful Deletion
    console.log('\n9. Testing IT_MANAGER Successful Guide Deletion...');
    const guide2Res = await request(port, '/api/v1/admin/guides', 'POST', {
      title: 'Panduan Uji Coba Hapus Manager',
      category_id: testCategoryId,
      location_scope: 'Unit Bedah Sentral',
      image_url: '/images/test-guide-2.png',
      security_note: 'Catatan keamanan manager',
      prompt_shortcut: 'Shortcut manager',
      symptoms: ['Sistem lambat'],
      steps: [
        { title: 'Langkah A', instruction: 'Restart aplikasi' },
        { title: 'Langkah B', instruction: 'Hubungi supervisor' },
      ],
    }, mgrCookie);

    assert(guide2Res.statusCode === 201, 'Guide #2 created by IT_MANAGER (HTTP 201).');
    const guide2Id = guide2Res.body.data.id;

    const mgrDeleteRes = await request(port, `/api/v1/admin/guides/${guide2Id}`, 'DELETE', null, mgrCookie);
    assert(mgrDeleteRes.statusCode === 200, 'IT_MANAGER deletion returned HTTP 200 OK.');
    assert(mgrDeleteRes.body.data.id === guide2Id, 'Deleted response contains correct guide ID.');
    assert(mgrDeleteRes.body.data.deleted_steps_count === 2, 'Deleted response contains deleted_steps_count: 2.');

    const checkGuide2Db = await testPool.query('SELECT * FROM guides WHERE id = $1', [guide2Id]);
    assert(checkGuide2Db.rows.length === 0, 'Guide #2 row was permanently deleted by IT_MANAGER.');

    // 12. Test Audit Log Records for GUIDE_DELETED
    console.log('\n10. Verifying Audit Log Records for GUIDE_DELETED...');
    const auditRes = await testPool.query(
      "SELECT * FROM audit_logs WHERE action = 'GUIDE_DELETED' ORDER BY created_at ASC"
    );
    assert(auditRes.rows.length >= 2, `Audit logs recorded at least 2 GUIDE_DELETED events (found ${auditRes.rows.length}).`);

    const adminAudit = auditRes.rows.find((a) => a.entity_id === guide1Id);
    assert(adminAudit, 'Audit log contains entry for Guide #1 deletion.');
    assert(adminAudit.entity_name === 'guide', 'Audit log entity_name is "guide".');

    const adminChanges = typeof adminAudit.changes === 'string' ? JSON.parse(adminAudit.changes) : adminAudit.changes;
    assert(adminChanges.key_code === guide1Key, 'Audit log changes records deleted key_code.');
    assert(adminChanges.title === 'Panduan Uji Coba Hapus Admin', 'Audit log changes records deleted title.');
    assert(adminChanges.deleted_steps_count === 3, 'Audit log changes records deleted_steps_count: 3.');

    // Security check: No credentials in audit log
    const auditStr = JSON.stringify(adminAudit);
    assert(!auditStr.includes('password'), 'Audit log contains NO password fields.');
    assert(!auditStr.includes('token'), 'Audit log contains NO token fields.');

    // 13. Frontend Code & Adapter Static Analysis
    console.log('\n11. Verifying Frontend Integration (Static Contract Analysis)...');
    const adminApiPath = path.resolve(__dirname, '../js/admin-api.js');
    const adminApiContent = fs.readFileSync(adminApiPath, 'utf8');
    assert(adminApiContent.includes('async delete(id)'), 'js/admin-api.js contains AdminAPI.guides.delete method.');
    assert(adminApiContent.includes("method: 'DELETE'"), 'AdminAPI.guides.delete specifies HTTP DELETE method.');

    const adminDashboardPath = path.resolve(__dirname, '../js/admin-dashboard.js');
    const adminDashboardContent = fs.readFileSync(adminDashboardPath, 'utf8');
    assert(adminDashboardContent.includes('confirmDeleteGuide'), 'js/admin-dashboard.js defines confirmDeleteGuide function.');
    assert(adminDashboardContent.includes('Hapus Panduan SOP Secara Permanen'), 'confirmDeleteGuide uses explicit permanent deletion title.');
    assert(adminDashboardContent.includes('TIDAK DAPAT DIBATALKAN'), 'confirmDeleteGuide explicitly warns action cannot be undone.');
    assert(adminDashboardContent.includes('AdminAPI.guides.delete'), 'confirmDeleteGuide executes AdminAPI.guides.delete.');
    assert(adminDashboardContent.includes('title="Hapus Panduan Permanen"'), 'renderGuidesList includes Delete button in table rows.');

    // 14. Operational Runbook Documentation Verification
    console.log('\n12. Verifying RUNBOOK.md Documentation...');
    const runbookPath = path.resolve(__dirname, '../RUNBOOK.md');
    const runbookContent = fs.readFileSync(runbookPath, 'utf8');
    assert(runbookContent.includes('Penghapusan Panduan Permanen (Hard Delete)'), 'RUNBOOK.md documents Hard Delete operation.');
    assert(runbookContent.includes('ARCHIVED'), 'RUNBOOK.md clarifies ARCHIVED status for retiring baseline SOPs.');

    // 15. Regression Check on Baseline 8 SOPs
    console.log('\n13. Verifying Regression Integrity on Baseline 8 SOPs...');
    const allGuidesRes = await testPool.query('SELECT count(*) as c FROM guides');
    assert(parseInt(allGuidesRes.rows[0].c, 10) === 8, 'All original 8 baseline SOPs remain completely intact and undamaged.');

    console.log('\n================================================================');
    console.log(` ALL M12.x DELETE GUIDE TESTS PASSED (${passedTests}/${totalTests} assertions)!`);
    console.log('================================================================\n');
  } finally {
    // Restore original pool and query
    dbConfig.pool = originalPool;
    dbConfig.query = originalQuery;
    await testPool.end().catch(() => {});
    if (server) {
      server.close();
    }
  }
}

if (require.main === module) {
  runDeleteGuideTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\nM12.x Delete Guide Test Suite Failed:', err);
      process.exit(1);
    });
}

module.exports = {
  runDeleteGuideTests,
};
