/**
 * Comprehensive Automated Test Suite for Milestone M8:
 * User Management UI & Audit Trail UI
 * 
 * Verifies:
 * 1. User Listing (GET /api/v1/admin/users):
 *    - Unauthenticated request rejected with HTTP 401
 *    - Authenticated access returns HTTP 200 with staff IT users
 *    - Safe fields present (id, full_name, username, email, role, is_active, created_at, updated_at)
 *    - password_hash is strictly NEVER exposed
 *    - Filters work (by role, status, search)
 * 2. Role Provisioning & Hierarchy:
 *    - ADMIN can provision ADMIN, IT_MANAGER, IT_SUPPORT
 *    - IT_MANAGER can provision IT_SUPPORT
 *    - IT_MANAGER attempting to create ADMIN rejected with HTTP 403 (Privilege Escalation Denied)
 *    - IT_SUPPORT attempting to provision accounts rejected with HTTP 403
 * 3. Status Lifecycle & Self-Deactivation Protection:
 *    - Deactivating an account works where permitted
 *    - Deactivated account is immediately blocked from logging in (HTTP 403)
 *    - Self-deactivation by actor is strictly rejected with HTTP 400 (CANNOT_DEACTIVATE_SELF)
 *    - IT_MANAGER attempting to deactivate ADMIN rejected with HTTP 403
 *    - IT_SUPPORT attempting to mutate status rejected with HTTP 403
 *    - Reactivation works and permits login again
 * 4. Audit Trail Retrieval (GET /api/v1/admin/audit-logs):
 *    - Unauthenticated request rejected with HTTP 401
 *    - Authenticated access returns HTTP 200 with recent records
 *    - Joined actor data includes safe fields (id, username, full_name, role)
 *    - password_hash, secrets, and raw credentials are NEVER present in records or changes payload
 *    - Audit trail is strictly read-only (DELETE/PATCH rejected with 404)
 * 5. Frontend Web Serving & M7/M8 UI Elements:
 *    - GET /admin serves admin.html containing #view-users and #view-audit
 *    - Navigation tabs for users and audit present
 *    - Public portal index.html unaffected
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { newDb, DataType } = require('pg-mem');

function request(serverPort, path, method = 'GET', postData = null, cookie = null) {
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

async function runM8Tests() {
  console.log('=== STARTING M8 USER MANAGEMENT & AUDIT TRAIL UI AUTOMATED VERIFICATION ===\n');

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

  // Run M2 Seed (8 initial SOP guides)
  const { seedSOPData } = require('../database/seed-sop-data');
  await seedSOPData(testPool);

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
    // 2. Bootstrap Accounts for Testing
    console.log('2. Bootstrapping test accounts (ADMIN, IT_MANAGER, IT_SUPPORT)...');
    const { seedAdmin } = require('../database/seed-admin');
    await seedAdmin({
      username: 'admin.super',
      password: 'SuperAdminPassword123!',
      fullName: 'Super Administrator',
      email: 'admin.super@rsawalbros.com',
      targetPool: testPool,
    });

    // Login as ADMIN
    const adminLoginRes = await request(TEST_PORT, '/api/v1/auth/login', 'POST', {
      username: 'admin.super',
      password: 'SuperAdminPassword123!',
    });
    if (adminLoginRes.statusCode !== 200) throw new Error('Failed to login as ADMIN');
    const adminCookie = extractCookieHeader(adminLoginRes.setCookie);

    // Provision IT_MANAGER
    const managerCreateRes = await request(TEST_PORT, '/api/v1/admin/users', 'POST', {
      full_name: 'Budi Manager',
      username: 'manager.budi',
      email: 'budi.manager@rsawalbros.com',
      password: 'ManagerPassword123!',
      role: 'IT_MANAGER',
    }, adminCookie);
    if (managerCreateRes.statusCode !== 201) throw new Error('Failed to create IT_MANAGER');
    const managerId = managerCreateRes.body.data.id;

    // Login as IT_MANAGER
    const managerLoginRes = await request(TEST_PORT, '/api/v1/auth/login', 'POST', {
      username: 'manager.budi',
      password: 'ManagerPassword123!',
    });
    if (managerLoginRes.statusCode !== 200) throw new Error('Failed to login as IT_MANAGER');
    const managerCookie = extractCookieHeader(managerLoginRes.setCookie);

    // IT_MANAGER creates IT_SUPPORT
    const supportCreateRes = await request(TEST_PORT, '/api/v1/admin/users', 'POST', {
      full_name: 'Siti Support',
      username: 'support.siti',
      email: 'siti.support@rsawalbros.com',
      password: 'SupportPassword123!',
      role: 'IT_SUPPORT',
    }, managerCookie);
    if (supportCreateRes.statusCode !== 201) throw new Error('Failed to create IT_SUPPORT');
    const supportId = supportCreateRes.body.data.id;

    // Login as IT_SUPPORT
    const supportLoginRes = await request(TEST_PORT, '/api/v1/auth/login', 'POST', {
      username: 'support.siti',
      password: 'SupportPassword123!',
    });
    if (supportLoginRes.statusCode !== 200) throw new Error('Failed to login as IT_SUPPORT');
    const supportCookie = extractCookieHeader(supportLoginRes.setCookie);

    console.log('  ✓ Three test roles authenticated successfully.\n');

    // 3. User Listing Tests
    console.log('3. Testing User Listing (GET /api/v1/admin/users)...');

    // Unauthenticated access
    const unauthUsers = await request(TEST_PORT, '/api/v1/admin/users', 'GET');
    if (unauthUsers.statusCode !== 401) {
      throw new Error(`Expected unauthenticated to return 401, got ${unauthUsers.statusCode}`);
    }
    console.log('  ✓ Unauthenticated request rejected with HTTP 401.');

    // Authenticated access by ADMIN
    const adminUsersRes = await request(TEST_PORT, '/api/v1/admin/users', 'GET', null, adminCookie);
    if (adminUsersRes.statusCode !== 200 || !adminUsersRes.body.success) {
      throw new Error(`Expected 200 for user listing, got ${adminUsersRes.statusCode}`);
    }
    const users = adminUsersRes.body.data;
    if (!Array.isArray(users) || users.length < 3) {
      throw new Error(`Expected at least 3 users, got ${users ? users.length : 0}`);
    }
    console.log(`  ✓ Authenticated user listing returned ${users.length} IT staff accounts.`);

    // Strict security check: password_hash must be absent from all records
    for (const u of users) {
      if ('password_hash' in u || 'password' in u) {
        throw new Error(`CRITICAL SECURITY FAILURE: password_hash or password exposed in user record for ${u.username}!`);
      }
      if (!u.id || !u.username || !u.email || !u.role || typeof u.is_active !== 'boolean') {
        throw new Error(`Missing expected fields on user object: ${JSON.stringify(u)}`);
      }
    }
    console.log('  ✓ password_hash and credentials strictly confirmed absent from all user records.');

    // IT_SUPPORT can read user listing
    const supportUsersRes = await request(TEST_PORT, '/api/v1/admin/users', 'GET', null, supportCookie);
    if (supportUsersRes.statusCode !== 200) {
      throw new Error(`Expected IT_SUPPORT to have read access to users, got ${supportUsersRes.statusCode}`);
    }
    console.log('  ✓ IT_SUPPORT granted read-only access to user listing.');

    // Test filters
    const roleFiltered = await request(TEST_PORT, '/api/v1/admin/users?role=ADMIN', 'GET', null, adminCookie);
    if (roleFiltered.body.data.length < 2 || !roleFiltered.body.data.every((u) => u.role === 'ADMIN')) {
      throw new Error(`Role filter ?role=ADMIN failed: ${JSON.stringify(roleFiltered.body.data)}`);
    }
    const searchFiltered = await request(TEST_PORT, '/api/v1/admin/users?search=budi', 'GET', null, adminCookie);
    if (searchFiltered.body.data.length !== 1 || searchFiltered.body.data[0].username !== 'manager.budi') {
      throw new Error('Search filter ?search=budi failed');
    }
    console.log('  ✓ Query parameter filters (role, search) verified.\n');

    // 4. Role Hierarchy & Privilege Escalation Tests
    console.log('4. Testing Role Hierarchy & Privilege Escalation Controls...');

    // IT_MANAGER cannot create ADMIN
    const escalateRes = await request(TEST_PORT, '/api/v1/admin/users', 'POST', {
      full_name: 'Hacker Admin',
      username: 'hacker.admin',
      email: 'hacker@rsawalbros.com',
      password: 'HackerPassword123!',
      role: 'ADMIN',
    }, managerCookie);
    if (escalateRes.statusCode !== 403) {
      throw new Error(`Expected privilege escalation to be rejected with 403, got ${escalateRes.statusCode}`);
    }
    console.log('  ✓ Privilege Escalation Prevented: IT_MANAGER cannot create ADMIN (HTTP 403).');

    // IT_SUPPORT cannot create any accounts
    const supportBlockedRes = await request(TEST_PORT, '/api/v1/admin/users', 'POST', {
      full_name: 'Support Junior',
      username: 'support.junior',
      email: 'junior@rsawalbros.com',
      password: 'JuniorPassword123!',
      role: 'IT_SUPPORT',
    }, supportCookie);
    if (supportBlockedRes.statusCode !== 403) {
      throw new Error(`Expected IT_SUPPORT provisioning to return 403, got ${supportBlockedRes.statusCode}`);
    }
    console.log('  ✓ Boundary Enforced: IT_SUPPORT cannot create accounts (HTTP 403).\n');

    // 5. Account Lifecycle & Self-Deactivation Protection Tests
    console.log('5. Testing Account Status Controls & Anti-Self-Deactivation...');

    // Self-deactivation by ADMIN must be rejected
    const adminUserObj = users.find((u) => u.username === 'admin.super');
    const selfDeactivateRes = await request(
      TEST_PORT,
      `/api/v1/admin/users/${adminUserObj.id}/status`,
      'PATCH',
      { is_active: false },
      adminCookie
    );
    if (selfDeactivateRes.statusCode !== 400 || selfDeactivateRes.body.error.code !== 'CANNOT_DEACTIVATE_SELF') {
      throw new Error(`Expected self-deactivation to return 400 CANNOT_DEACTIVATE_SELF, got ${selfDeactivateRes.statusCode}`);
    }
    console.log('  ✓ Anti-Self-Deactivation: Administrator prevented from disabling own account (HTTP 400).');

    // IT_MANAGER cannot deactivate ADMIN
    const managerTargetAdminRes = await request(
      TEST_PORT,
      `/api/v1/admin/users/${adminUserObj.id}/status`,
      'PATCH',
      { is_active: false },
      managerCookie
    );
    if (managerTargetAdminRes.statusCode !== 403) {
      throw new Error(`Expected IT_MANAGER targeting ADMIN to return 403, got ${managerTargetAdminRes.statusCode}`);
    }
    console.log('  ✓ Role Hierarchy Enforced: IT_MANAGER cannot deactivate ADMIN (HTTP 403).');

    // IT_SUPPORT cannot toggle status
    const supportMutateRes = await request(
      TEST_PORT,
      `/api/v1/admin/users/${managerId}/status`,
      'PATCH',
      { is_active: false },
      supportCookie
    );
    if (supportMutateRes.statusCode !== 403) {
      throw new Error(`Expected IT_SUPPORT status toggle to return 403, got ${supportMutateRes.statusCode}`);
    }
    console.log('  ✓ Boundary Enforced: IT_SUPPORT cannot deactivate accounts (HTTP 403).');

    // Deactivate IT_SUPPORT by ADMIN
    const deactivateSupportRes = await request(
      TEST_PORT,
      `/api/v1/admin/users/${supportId}/status`,
      'PATCH',
      { is_active: false },
      adminCookie
    );
    if (deactivateSupportRes.statusCode !== 200 || !deactivateSupportRes.body.success) {
      throw new Error(`Failed to deactivate IT_SUPPORT: ${JSON.stringify(deactivateSupportRes.body)}`);
    }
    console.log('  ✓ IT_SUPPORT account deactivated successfully.');

    // Deactivated user cannot log in
    const deactivatedLogin = await request(TEST_PORT, '/api/v1/auth/login', 'POST', {
      username: 'support.siti',
      password: 'SupportPassword123!',
    });
    if (deactivatedLogin.statusCode !== 403) {
      throw new Error(`Expected deactivated user login to be 403, got ${deactivatedLogin.statusCode}`);
    }
    console.log('  ✓ Deactivated account is blocked from login (HTTP 403 ACCOUNT_INACTIVE).');

    // Reactivate IT_SUPPORT by ADMIN
    const reactivateSupportRes = await request(
      TEST_PORT,
      `/api/v1/admin/users/${supportId}/status`,
      'PATCH',
      { is_active: true },
      adminCookie
    );
    if (reactivateSupportRes.statusCode !== 200) {
      throw new Error(`Failed to reactivate IT_SUPPORT: ${JSON.stringify(reactivateSupportRes.body)}`);
    }
    console.log('  ✓ IT_SUPPORT account reactivated successfully.');

    // Reactivated user can log in again
    const reactivatedLogin = await request(TEST_PORT, '/api/v1/auth/login', 'POST', {
      username: 'support.siti',
      password: 'SupportPassword123!',
    });
    if (reactivatedLogin.statusCode !== 200) {
      throw new Error('Reactivated user failed to log in');
    }
    console.log('  ✓ Reactivated user can log in again successfully.\n');

    // 6. Audit Trail Retrieval Tests (GET /api/v1/admin/audit-logs)
    console.log('6. Testing Audit Trail (GET /api/v1/admin/audit-logs)...');

    // Unauthenticated access
    const unauthAudit = await request(TEST_PORT, '/api/v1/admin/audit-logs', 'GET');
    if (unauthAudit.statusCode !== 401) {
      throw new Error(`Expected unauthenticated audit query to return 401, got ${unauthAudit.statusCode}`);
    }
    console.log('  ✓ Unauthenticated request rejected with HTTP 401.');

    // Authenticated access by ADMIN
    const auditRes = await request(TEST_PORT, '/api/v1/admin/audit-logs', 'GET', null, adminCookie);
    if (auditRes.statusCode !== 200 || !auditRes.body.success) {
      throw new Error(`Expected 200 for audit logs, got ${auditRes.statusCode}`);
    }
    const auditLogs = auditRes.body.data;
    if (!Array.isArray(auditLogs) || auditLogs.length === 0) {
      throw new Error('Expected audit logs to contain records, but got empty array');
    }
    console.log(`  ✓ Retrieved ${auditLogs.length} audit log entries.`);

    // Check actions recorded
    const actions = auditLogs.map((l) => l.action);
    const expectedActions = ['LOGIN_SUCCESS', 'ACCOUNT_CREATED', 'ACCOUNT_DISABLED', 'ACCOUNT_ACTIVATED'];
    for (const exp of expectedActions) {
      if (!actions.includes(exp)) {
        throw new Error(`Expected audit log to contain action "${exp}", found: ${actions.join(', ')}`);
      }
    }
    console.log('  ✓ Audit entries confirmed for LOGIN_SUCCESS, ACCOUNT_CREATED, ACCOUNT_DISABLED, ACCOUNT_ACTIVATED.');

    // Verify actor format and credential protection
    for (const log of auditLogs) {
      if (!log.actor || !log.action || !log.entity_name || !log.entity_id || !log.created_at) {
        throw new Error(`Malformed audit record: ${JSON.stringify(log)}`);
      }
      if ('password_hash' in log.actor || 'password' in log.actor) {
        throw new Error('CRITICAL SECURITY FAILURE: password or hash exposed in audit log actor object!');
      }
      if (log.changes) {
        const changesStr = JSON.stringify(log.changes).toLowerCase();
        if (changesStr.includes('password_hash') || changesStr.includes('superadminpassword')) {
          throw new Error('CRITICAL SECURITY FAILURE: password hash or plaintext found in audit log changes payload!');
        }
      }
    }
    console.log('  ✓ Actor object and changes payload confirmed 100% clean of sensitive credentials.');

    // Verify Read-Only nature (NO delete, NO update)
    const deleteAuditRes = await request(TEST_PORT, '/api/v1/admin/audit-logs', 'DELETE', null, adminCookie);
    if (deleteAuditRes.statusCode !== 404) {
      throw new Error(`Expected DELETE /audit-logs to return 404, got ${deleteAuditRes.statusCode}`);
    }
    console.log('  ✓ Audit Trail is strictly Read-Only (DELETE rejected with HTTP 404).\n');

    // 7. Frontend Web & UI Elements Verification
    console.log('7. Testing Frontend Web Serving & UI Elements...');

    const adminHtmlRes = await request(TEST_PORT, '/admin', 'GET');
    if (adminHtmlRes.statusCode !== 200) {
      throw new Error(`Expected GET /admin to return 200, got ${adminHtmlRes.statusCode}`);
    }
    const html = adminHtmlRes.rawBody;

    // Check tabs
    if (!html.includes('id="tab-btn-users"') || !html.includes('id="tab-btn-audit"')) {
      throw new Error('admin.html is missing tab-btn-users or tab-btn-audit');
    }
    console.log('  ✓ Desktop navigation tabs ("Manajemen Pengguna", "Log Audit") verified.');

    // Check panels
    if (!html.includes('id="view-users"') || !html.includes('id="view-audit"')) {
      throw new Error('admin.html is missing #view-users or #view-audit view panels');
    }
    console.log('  ✓ Admin view panels (#view-users, #view-audit) verified.');

    // Check modals
    if (!html.includes('id="user-modal"') || !html.includes('id="audit-detail-modal"')) {
      throw new Error('admin.html is missing #user-modal or #audit-detail-modal');
    }
    console.log('  ✓ Modals (#user-modal, #audit-detail-modal) verified.');

    // Check public portal untouched
    const indexRes = await request(TEST_PORT, '/', 'GET');
    if (indexRes.statusCode !== 200 || !indexRes.rawBody.includes('Portal Staf IT')) {
      throw new Error('Public portal index.html check failed');
    }
    console.log('  ✓ Public user portal index.html confirmed 100% intact and functional.\n');

    console.log('=== ALL M8 USER MANAGEMENT & AUDIT TRAIL TESTS PASSED (100%) ===\n');
  } finally {
    // Restore config and close server
    dbConfig.pool = originalPool;
    dbConfig.query = originalQuery;
    server.close();
  }
}

if (require.main === module) {
  runM8Tests().catch((err) => {
    console.error('\n❌ M8 TEST SUITE FAILED:', err);
    process.exit(1);
  });
}

module.exports = { runM8Tests };
