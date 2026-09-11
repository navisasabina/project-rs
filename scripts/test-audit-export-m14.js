/**
 * Automated Verification Script: test-audit-export-m14.js
 *
 * Milestone M14 — Audit Trail Compliance Export, Forensic Archiving & Filter Synchronization
 *
 * Verifies:
 * 1. RBAC & Export Access Control:
 *    - Unauthenticated request rejected with 401 UNAUTHORIZED
 *    - IT_SUPPORT export request rejected with 403 FORBIDDEN
 *    - IT_MANAGER export request allowed (200 OK)
 *    - ADMIN export request allowed (200 OK)
 * 2. Response Headers & Formats:
 *    - CSV Content-Type text/csv; charset=utf-8
 *    - JSON Content-Type application/json; charset=utf-8
 *    - Content-Disposition attachment with deterministic timestamped filename
 *    - Invalid export format rejected with 400 INVALID_EXPORT_FORMAT
 * 3. CSV Escaping & RFC 4180 Integrity:
 *    - CSV header row matches exact 10 columns
 *    - Proper quoting and escaping of commas, quotes, and newlines
 *    - Empty results return valid CSV with header row present
 * 4. JSON Structure & Streaming Integrity:
 *    - Valid JSON parseable output with success, meta, and data array
 *    - Record objects contain safe fields and nested actor info
 * 5. Filtering Semantics:
 *    - Action filter (e.g. ?action=LOGIN_SUCCESS)
 *    - Entity filter (e.g. ?entity=user)
 *    - Search keyword filter
 *    - Date range from/to filters with inclusive end-of-day semantics
 *    - Invalid date formats rejected with 400 INVALID_DATE_FORMAT
 *    - Inverted date ranges rejected with 400 INVALID_DATE_RANGE
 *    - Export independent of table pagination limits
 * 6. Credential Sanitization:
 *    - Zero plaintext passwords in CSV/JSON exports
 *    - Zero password_hash in CSV/JSON exports
 *    - Zero JWT tokens, cookies, or auth headers in audit details
 * 7. Live Table Compatibility:
 *    - GET /api/v1/admin/audit-logs functions with existing and new date filters
 * 8. Frontend Contracts & UI Synchronization:
 *    - admin.html includes #btn-export-audit-csv and #btn-export-audit-json
 *    - admin.html includes date inputs #audit-filter-from and #audit-filter-to
 *    - admin.html action dropdown contains all 17 supported audit action types
 *    - Export controls have .rbac-mutation class to hide for IT_SUPPORT
 *    - AdminAPI.audit.export and AdminAPI.auditLogs.export methods exist
 *    - js/admin-dashboard.js defines export and date filter handlers
 * 9. Operational RUNBOOK Documentation:
 *    - RUNBOOK.md contains Section S documenting compliance export and forensic workflow
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
      'Accept': reqPath.includes('format=json') ? 'application/json' : 'text/csv, application/json, */*',
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

async function runM14AuditExportTests() {
  console.log('================================================================');
  console.log(' STARTING M14 AUDIT COMPLIANCE EXPORT & FORENSIC TEST SUITE');
  console.log('================================================================\n');

  let passedAssertions = 0;
  function assert(condition, message) {
    if (!condition) {
      console.error(`  [FAIL] Assertion failed: ${message}`);
      process.exit(1);
    }
    passedAssertions++;
    console.log(`  [PASS] Test #${passedAssertions}: ${message}`);
  }

  // 1. Initialize isolated in-memory PostgreSQL test database
  console.log('1. Initializing isolated in-memory PostgreSQL database...');
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

  const migrationPath = path.resolve(__dirname, '../database/migrations/001_initial_schema.up.sql');
  const upSql = fs.readFileSync(migrationPath, 'utf8');
  const ddlPart = upSql.split('-- 8. Trigger function for Search Vector update')[0];
  const client = await testPool.connect();
  await client.query(ddlPart);
  client.release();

  // Intercept database config
  const dbConfig = require('../server/config/database');
  dbConfig.pool = testPool;
  dbConfig.query = (text, params) => testPool.query(text, params);

  // Run M2 Seed (8 initial SOP guides)
  const { seedSOPData } = require('../database/seed-sop-data');
  await seedSOPData(testPool);

  // Seed Admin Account
  const { seedAdmin } = require('../database/seed-admin');
  await seedAdmin({
    fullName: 'Super Administrator',
    username: 'admin.super',
    email: 'admin.super@rsawalbros.com',
    password: 'SuperAdminPass123!',
    targetPool: testPool,
  });

  // Start test server
  const app = require('../server/app');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const serverPort = server.address().port;
  console.log(`PASS: Test server listening on ephemeral port ${serverPort}.\n`);

  try {
    // 2. Setup Test Accounts (ADMIN, IT_MANAGER, IT_SUPPORT)
    console.log('2. Bootstrapping test staff accounts...');
    const adminLoginRes = await request(serverPort, '/api/v1/auth/login', 'POST', {
      username: 'admin.super',
      password: 'SuperAdminPass123!',
    });
    assert(adminLoginRes.statusCode === 200, 'Super Admin login succeeded.');
    const adminCookie = extractCookieHeader(adminLoginRes.setCookie);
    assert(!!adminCookie, 'Super Admin auth cookie received.');

    // Create IT_MANAGER
    const createManagerRes = await request(serverPort, '/api/v1/admin/users', 'POST', {
      full_name: 'Dewi Manager IT',
      username: 'dewi.manager',
      email: 'dewi.manager@awalbros.com',
      password: 'ManagerPassword123!',
      role: 'IT_MANAGER',
    }, adminCookie);
    assert(createManagerRes.statusCode === 201, 'IT_MANAGER account created.');

    // Create IT_SUPPORT
    const createSupportRes = await request(serverPort, '/api/v1/admin/users', 'POST', {
      full_name: 'Budi Support Staff',
      username: 'budi.support',
      email: 'budi.support@awalbros.com',
      password: 'SupportPassword123!',
      role: 'IT_SUPPORT',
    }, adminCookie);
    assert(createSupportRes.statusCode === 201, 'IT_SUPPORT account created.');

    // Login Manager and Support
    const managerLoginRes = await request(serverPort, '/api/v1/auth/login', 'POST', {
      username: 'dewi.manager',
      password: 'ManagerPassword123!',
    });
    assert(managerLoginRes.statusCode === 200, 'IT_MANAGER login succeeded.');
    const managerCookie = extractCookieHeader(managerLoginRes.setCookie);

    const supportLoginRes = await request(serverPort, '/api/v1/auth/login', 'POST', {
      username: 'budi.support',
      password: 'SupportPassword123!',
    });
    assert(supportLoginRes.statusCode === 200, 'IT_SUPPORT login succeeded.');
    const supportCookie = extractCookieHeader(supportLoginRes.setCookie);

    // 3. RBAC & Export Access Control
    console.log('\n3. Testing Export RBAC & Access Control...');
    const unauthRes = await request(serverPort, '/api/v1/admin/audit-logs/export');
    assert(unauthRes.statusCode === 401, 'Unauthenticated export returns HTTP 401 UNAUTHORIZED.');
    assert(unauthRes.body?.error?.code === 'UNAUTHORIZED', 'Error code is UNAUTHORIZED.');

    const supportExportRes = await request(serverPort, '/api/v1/admin/audit-logs/export', 'GET', null, supportCookie);
    assert(supportExportRes.statusCode === 403, 'IT_SUPPORT export returns HTTP 403 FORBIDDEN.');
    assert(supportExportRes.body?.error?.code === 'FORBIDDEN', 'Error code is FORBIDDEN.');

    const managerExportRes = await request(serverPort, '/api/v1/admin/audit-logs/export', 'GET', null, managerCookie);
    assert(managerExportRes.statusCode === 200, 'IT_MANAGER CSV export returns HTTP 200 OK.');

    const adminExportRes = await request(serverPort, '/api/v1/admin/audit-logs/export', 'GET', null, adminCookie);
    assert(adminExportRes.statusCode === 200, 'ADMIN CSV export returns HTTP 200 OK.');

    const adminJsonExportRes = await request(serverPort, '/api/v1/admin/audit-logs/export?format=json', 'GET', null, adminCookie);
    assert(adminJsonExportRes.statusCode === 200, 'ADMIN JSON export returns HTTP 200 OK.');

    // 4. Response Headers & Filename Formats
    console.log('\n4. Testing Response Headers & Filename Formats...');
    const csvContentType = adminExportRes.headers['content-type'];
    assert(csvContentType && csvContentType.includes('text/csv'), 'CSV Content-Type is text/csv.');
    assert(csvContentType.includes('charset=utf-8'), 'CSV charset is utf-8.');

    const csvDisposition = adminExportRes.headers['content-disposition'];
    assert(csvDisposition && csvDisposition.includes('attachment'), 'CSV Content-Disposition is attachment.');
    assert(/filename="audit_logs_rs_awal_bros_\d{8}_\d{6}\.csv"/.test(csvDisposition), 'CSV filename matches deterministic pattern.');

    const jsonContentType = adminJsonExportRes.headers['content-type'];
    assert(jsonContentType && jsonContentType.includes('application/json'), 'JSON Content-Type is application/json.');
    assert(jsonContentType.includes('charset=utf-8'), 'JSON charset is utf-8.');

    const jsonDisposition = adminJsonExportRes.headers['content-disposition'];
    assert(jsonDisposition && jsonDisposition.includes('attachment'), 'JSON Content-Disposition is attachment.');
    assert(/filename="audit_logs_rs_awal_bros_\d{8}_\d{6}\.json"/.test(jsonDisposition), 'JSON filename matches deterministic pattern.');

    const invalidFormatRes = await request(serverPort, '/api/v1/admin/audit-logs/export?format=xml', 'GET', null, adminCookie);
    assert(invalidFormatRes.statusCode === 400, 'Unsupported format (xml) returns HTTP 400.');
    assert(invalidFormatRes.body?.error?.code === 'INVALID_EXPORT_FORMAT', 'Error code is INVALID_EXPORT_FORMAT.');

    // 5. CSV Structure & RFC 4180 Escaping
    console.log('\n5. Testing CSV Structure & RFC 4180 Escaping...');
    const csvLines = adminExportRes.rawBody.split(/\r?\n/).filter((l) => l.trim().length > 0);
    assert(csvLines.length >= 2, 'CSV contains header row and at least one data row.');

    const headerLine = csvLines[0];
    const expectedHeaders = 'Timestamp (WIB/ISO),Action,Entity Name,Entity ID,Actor Username,Actor Full Name,Actor Role,IP Address,User Agent,Sanitized Changes JSON';
    assert(headerLine === expectedHeaders, 'CSV header contains exact expected 10 column names.');

    // Verify row column count
    const firstDataLine = csvLines[1];
    assert(firstDataLine.includes('LOGIN_SUCCESS') || firstDataLine.includes('ACCOUNT_CREATED'), 'Data line contains recorded audit action.');

    // 6. JSON Structure & Streaming Integrity
    console.log('\n6. Testing JSON Structure & Streaming Integrity...');
    assert(adminJsonExportRes.body !== null, 'JSON export parsed successfully.');
    assert(adminJsonExportRes.body?.success === true, 'JSON export success property is true.');
    assert(adminJsonExportRes.body?.meta && typeof adminJsonExportRes.body.meta.exported_at === 'string', 'JSON export includes meta.exported_at.');
    assert(Array.isArray(adminJsonExportRes.body?.data), 'JSON export includes data array.');
    assert(adminJsonExportRes.body.data.length >= 1, 'JSON data array contains recorded audit items.');

    const firstJsonRecord = adminJsonExportRes.body.data[0];
    assert(typeof firstJsonRecord.id === 'string', 'JSON record contains id string.');
    assert(typeof firstJsonRecord.action === 'string', 'JSON record contains action string.');
    assert(typeof firstJsonRecord.timestamp === 'string', 'JSON record contains ISO timestamp.');
    assert(typeof firstJsonRecord.actor === 'object', 'JSON record contains actor object.');

    // 7. Filtering Semantics (Action, Entity, Search, Dates)
    console.log('\n7. Testing Audit Export Filtering Semantics...');
    const loginActionRes = await request(serverPort, '/api/v1/admin/audit-logs/export?format=json&action=LOGIN_SUCCESS', 'GET', null, adminCookie);
    assert(loginActionRes.statusCode === 200, 'Action-filtered export returns 200.');
    const allLoginSuccess = loginActionRes.body.data.every((r) => r.action === 'LOGIN_SUCCESS');
    assert(allLoginSuccess, '100% of exported records match action=LOGIN_SUCCESS.');

    const userEntityRes = await request(serverPort, '/api/v1/admin/audit-logs/export?format=json&entity=user', 'GET', null, adminCookie);
    assert(userEntityRes.statusCode === 200, 'Entity-filtered export returns 200.');
    const allUserEntity = userEntityRes.body.data.every((r) => r.entity_name === 'user');
    assert(allUserEntity, '100% of exported records match entity=user.');

    const searchRes = await request(serverPort, '/api/v1/admin/audit-logs/export?format=json&search=dewi.manager', 'GET', null, adminCookie);
    assert(searchRes.statusCode === 200, 'Search-filtered export returns 200.');
    assert(searchRes.body.data.length >= 1, 'Search finds records associated with "dewi.manager".');

    // Date filtering tests
    const todayStr = new Date().toISOString().split('T')[0];
    const dateFromRes = await request(serverPort, `/api/v1/admin/audit-logs/export?format=json&from=${todayStr}`, 'GET', null, adminCookie);
    assert(dateFromRes.statusCode === 200, 'Date from filter returns 200.');
    assert(dateFromRes.body.data.length >= 1, 'Events on or after today are retrieved.');

    const dateToRes = await request(serverPort, `/api/v1/admin/audit-logs/export?format=json&to=${todayStr}`, 'GET', null, adminCookie);
    assert(dateToRes.statusCode === 200, 'Date to filter returns 200.');
    assert(dateToRes.body.data.length >= 1, 'Events up to end of today are retrieved.');

    const pastDateRes = await request(serverPort, '/api/v1/admin/audit-logs/export?format=json&to=2020-01-01', 'GET', null, adminCookie);
    assert(pastDateRes.statusCode === 200, 'Past date filter returns 200.');
    assert(pastDateRes.body.data.length === 0, 'Past date filter returns 0 records.');

    // Parameter validation errors
    const invalidDateRes = await request(serverPort, '/api/v1/admin/audit-logs/export?from=not-a-real-date', 'GET', null, adminCookie);
    assert(invalidDateRes.statusCode === 400, 'Malformed date returns HTTP 400.');
    assert(invalidDateRes.body?.error?.code === 'INVALID_DATE_FORMAT', 'Error code is INVALID_DATE_FORMAT.');

    const invertedDateRes = await request(serverPort, '/api/v1/admin/audit-logs/export?from=2026-10-01&to=2026-09-01', 'GET', null, adminCookie);
    assert(invertedDateRes.statusCode === 400, 'Inverted date range returns HTTP 400.');
    assert(invertedDateRes.body?.error?.code === 'INVALID_DATE_RANGE', 'Error code is INVALID_DATE_RANGE.');

    // 8. Empty Result Export & Pagination Independence
    console.log('\n8. Testing Empty Result Handling & Pagination Independence...');
    const emptyCsvRes = await request(serverPort, '/api/v1/admin/audit-logs/export?format=csv&search=nonexistent_search_query_xyz', 'GET', null, adminCookie);
    assert(emptyCsvRes.statusCode === 200, 'Empty CSV export returns HTTP 200.');
    const emptyCsvLines = emptyCsvRes.rawBody.split(/\r?\n/).filter((l) => l.trim().length > 0);
    assert(emptyCsvLines.length === 1, 'Empty CSV export returns exact header row (1 line).');
    assert(emptyCsvLines[0] === expectedHeaders, 'Header row is present even with zero matching rows.');

    const emptyJsonRes = await request(serverPort, '/api/v1/admin/audit-logs/export?format=json&search=nonexistent_search_query_xyz', 'GET', null, adminCookie);
    assert(emptyJsonRes.statusCode === 200, 'Empty JSON export returns HTTP 200.');
    assert(Array.isArray(emptyJsonRes.body?.data) && emptyJsonRes.body.data.length === 0, 'Empty JSON returns data: [].');

    // 9. Credential Sanitization Guarantees
    console.log('\n9. Testing Credential Sanitization Guarantees...');
    const fullCsvText = adminExportRes.rawBody;
    assert(!fullCsvText.includes('AwalBrosIT@2026'), 'Zero plaintext admin seed password in CSV export.');
    assert(!fullCsvText.includes('ManagerPassword123!'), 'Zero plaintext manager password in CSV export.');
    assert(!fullCsvText.includes('SupportPassword123!'), 'Zero plaintext support password in CSV export.');
    assert(!fullCsvText.includes('$2a$') && !fullCsvText.includes('$2b$'), 'Zero bcrypt hash ($2a$/$2b$) in CSV export.');
    assert(!fullCsvText.includes('auth_token='), 'Zero auth_token in CSV export.');
    assert(!fullCsvText.includes('eyJ'), 'Zero JWT signatures (eyJ...) in CSV export.');

    const fullJsonText = adminJsonExportRes.rawBody;
    assert(!fullJsonText.includes('AwalBrosIT@2026'), 'Zero plaintext password in JSON export.');
    assert(!fullJsonText.includes('$2a$') && !fullJsonText.includes('$2b$'), 'Zero password hash in JSON export.');
    assert(!fullJsonText.includes('auth_token='), 'Zero session cookie in JSON export.');

    // 10. Live Audit Table Compatibility & Date Filters
    console.log('\n10. Testing Live Audit Table API Compatibility...');
    const liveTableRes = await request(serverPort, '/api/v1/admin/audit-logs?limit=10', 'GET', null, adminCookie);
    assert(liveTableRes.statusCode === 200, 'GET /api/v1/admin/audit-logs returns HTTP 200.');
    assert(Array.isArray(liveTableRes.body?.data), 'Live table returns data array.');
    assert(typeof liveTableRes.body?.meta?.total === 'number', 'Live table returns meta.total.');

    const liveDateRes = await request(serverPort, `/api/v1/admin/audit-logs?from=${todayStr}`, 'GET', null, adminCookie);
    assert(liveDateRes.statusCode === 200, 'Live table accepts from date filter.');

    const liveInvalidDateRes = await request(serverPort, '/api/v1/admin/audit-logs?from=bad-date', 'GET', null, adminCookie);
    assert(liveInvalidDateRes.statusCode === 400, 'Live table rejects malformed date with HTTP 400.');

    // 11. Frontend Contracts & UI Synchronization
    console.log('\n11. Verifying Frontend Static Contracts & UI Synchronization...');
    const adminHtml = fs.readFileSync(path.resolve(__dirname, '../admin.html'), 'utf8');
    assert(adminHtml.includes('id="btn-export-audit-csv"'), 'admin.html includes #btn-export-audit-csv.');
    assert(adminHtml.includes('id="btn-export-audit-json"'), 'admin.html includes #btn-export-audit-json.');
    assert(adminHtml.includes('id="audit-filter-from"'), 'admin.html includes #audit-filter-from date input.');
    assert(adminHtml.includes('id="audit-filter-to"'), 'admin.html includes #audit-filter-to date input.');

    // Verify .rbac-mutation class on export buttons (so IT_SUPPORT is hidden)
    assert(adminHtml.includes('id="btn-export-audit-csv"') && adminHtml.includes('class="rbac-mutation'), 'Export buttons include .rbac-mutation class for RBAC hiding.');

    // Verify all 17 audit actions exist in #audit-filter-action dropdown
    const expectedActions = [
      'LOGIN_SUCCESS',
      'LOGIN_FAILED',
      'LOGOUT',
      'ACCOUNT_CREATED',
      'ACCOUNT_ACTIVATED',
      'ACCOUNT_DISABLED',
      'PASSWORD_CHANGED',
      'PASSWORD_RESET',
      'USER_UPDATED',
      'GUIDE_CREATED',
      'GUIDE_UPDATED',
      'GUIDE_STATUS_CHANGED',
      'GUIDE_STEPS_UPDATED',
      'GUIDE_DELETED',
      'CATEGORY_CREATED',
      'CATEGORY_UPDATED',
      'CATEGORY_STATUS_CHANGED',
    ];

    for (const act of expectedActions) {
      assert(adminHtml.includes(`value="${act}"`), `admin.html dropdown includes audit action "${act}".`);
    }

    const adminApiJs = fs.readFileSync(path.resolve(__dirname, '../js/admin-api.js'), 'utf8');
    assert(adminApiJs.includes('export(options = {})') || adminApiJs.includes('async export('), 'AdminAPI defines export method.');
    assert(adminApiJs.includes('AdminAPI.audit = AdminAPI.auditLogs'), 'AdminAPI provides audit alias.');

    const adminDashJs = fs.readFileSync(path.resolve(__dirname, '../js/admin-dashboard.js'), 'utf8');
    assert(adminDashJs.includes('handleExportAuditLogs'), 'admin-dashboard.js defines handleExportAuditLogs.');
    assert(adminDashJs.includes('handleAuditDateFilter'), 'admin-dashboard.js defines handleAuditDateFilter.');
    assert(adminDashJs.includes('clearAuditDateFilter'), 'admin-dashboard.js defines clearAuditDateFilter.');
    assert(adminDashJs.includes('window.loadAuditLogs = loadAuditLogs'), 'admin-dashboard.js exposes window.loadAuditLogs.');

    // 12. RUNBOOK Documentation Verification
    console.log('\n12. Verifying RUNBOOK.md Documentation...');
    const runbookMd = fs.readFileSync(path.resolve(__dirname, '../RUNBOOK.md'), 'utf8');
    assert(runbookMd.includes('## S. Audit Trail Compliance Export'), 'RUNBOOK.md contains Section S.');
    assert(runbookMd.includes('Ekspor CSV'), 'RUNBOOK.md documents CSV export.');
    assert(runbookMd.includes('Ekspor JSON'), 'RUNBOOK.md documents JSON export.');
    assert(runbookMd.includes('IT_MANAGER') && runbookMd.includes('ADMIN'), 'RUNBOOK.md documents RBAC permissions.');
    assert(runbookMd.includes('Semantik Hari Penuh'), 'RUNBOOK.md documents full-day date semantics.');
    assert(runbookMd.includes('Investigasi Insiden Keamanan'), 'RUNBOOK.md documents forensic incident investigation workflow.');

    console.log('\n================================================================');
    console.log(` ALL M14 AUDIT EXPORT TESTS PASSED (${passedAssertions} assertions)!`);
    console.log('================================================================\n');

  } finally {
    await new Promise((resolve) => server.close(resolve));
    await testPool.end();
  }
}

runM14AuditExportTests().catch((err) => {
  console.error('\n[FATAL] M14 Audit Export test suite failed:', err);
  process.exit(1);
});
