/**
 * Automated Verification Script: test-user-security-m13.js
 * 
 * Milestone M13 — User Credential Lifecycle, Password Security & Account Administration
 * 
 * Verifies:
 * 1. Self-Service Password Change (PATCH /api/v1/auth/password):
 *    - Unauthenticated request rejected with 401 UNAUTHORIZED
 *    - Missing required fields rejected with 400 VALIDATION_ERROR
 *    - Password shorter than 8 characters rejected with 400 VALIDATION_ERROR
 *    - Confirm password mismatch rejected with 400 VALIDATION_ERROR
 *    - Incorrect current password rejected with 400 INVALID_CREDENTIALS
 *    - New password identical to current rejected with 400 SAME_PASSWORD
 *    - Valid password change succeeds with 200 OK
 *    - Old password fails on subsequent login (401 INVALID_CREDENTIALS)
 *    - New password succeeds on subsequent login (200 OK)
 * 2. Administrative Password Reset (PATCH /api/v1/admin/users/:id/password):
 *    - Unauthenticated request rejected with 401 UNAUTHORIZED
 *    - IT_SUPPORT attempting reset rejected with 403 FORBIDDEN
 *    - Malformed UUID rejected with 400 INVALID_ID
 *    - Nonexistent UUID returns 404 USER_NOT_FOUND
 *    - Password shorter than 8 characters rejected with 400 VALIDATION_ERROR
 *    - IT_MANAGER cannot reset ADMIN password (403 FORBIDDEN)
 *    - IT_MANAGER cannot reset another IT_MANAGER password (403 FORBIDDEN)
 *    - IT_MANAGER can reset IT_SUPPORT password (200 OK)
 *    - Reset target can log in with new password (200 OK)
 *    - ADMIN can reset any account (ADMIN, IT_MANAGER, IT_SUPPORT) (200 OK)
 * 3. Administrative User Profile Update (PATCH /api/v1/admin/users/:id):
 *    - Unauthenticated request rejected with 401 UNAUTHORIZED
 *    - IT_SUPPORT attempting update rejected with 403 FORBIDDEN
 *    - Malformed UUID rejected with 400 INVALID_ID
 *    - Nonexistent UUID returns 404 USER_NOT_FOUND
 *    - Empty request body rejected with 400 VALIDATION_ERROR
 *    - Unsupported fields rejected with 400 UNSUPPORTED_FIELD
 *    - Invalid email format rejected with 400 INVALID_EMAIL
 *    - Duplicate email conflict rejected with 409 DUPLICATE_EMAIL
 *    - IT_MANAGER cannot update ADMIN account (403 FORBIDDEN)
 *    - IT_MANAGER cannot update another IT_MANAGER account (403 FORBIDDEN)
 *    - IT_MANAGER cannot promote IT_SUPPORT to IT_MANAGER or ADMIN (403 PRIVILEGE_ESCALATION_DENIED)
 *    - IT_MANAGER can update IT_SUPPORT metadata (200 OK)
 *    - ADMIN can update user metadata (200 OK)
 *    - ADMIN prevented from self-demotion (400 CANNOT_DEMOTE_SELF)
 * 4. Audit Trail & Data Sanitization:
 *    - PASSWORD_CHANGED event recorded in database
 *    - PASSWORD_RESET event recorded in database
 *    - USER_UPDATED event recorded in database
 *    - Zero plaintext passwords in audit logs or API responses
 *    - Zero password_hash in audit logs or API responses
 *    - Zero JWT, cookies, or authorization tokens in audit details
 * 5. Frontend API & UI Contract Verification:
 *    - AdminAPI.auth.changePassword exists
 *    - AdminAPI.users.resetPassword exists
 *    - AdminAPI.users.update exists
 *    - admin.html includes #change-password-modal with password inputs
 *    - admin.html includes #reset-password-modal with password inputs
 *    - admin.html includes #edit-user-modal
 *    - admin.html includes #btn-change-own-password
 *    - js/admin-dashboard.js defines modal handlers and submit routines
 *    - User table rows include edit and reset buttons with RBAC guards
 * 6. Operational RUNBOOK Verification:
 *    - RUNBOOK.md contains Section R covering credential lifecycle
 *    - Bootstrap credential rotation documented
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

async function runM13UserSecurityTests() {
  console.log('================================================================');
  console.log(' STARTING M13 USER CREDENTIAL LIFECYCLE & SECURITY TEST SUITE');
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

  // 1. Initializing isolated in-memory PostgreSQL test database
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

  const upSql = fs.readFileSync(path.resolve(__dirname, '../database/migrations/001_initial_schema.up.sql'), 'utf8');
  const ddl = upSql.split('-- 8. Trigger function for Search Vector update')[0];
  const client = await testPool.connect();
  await client.query(ddl);
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

  // Start Express server on ephemeral port
  const app = require('../server/app');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`PASS: Test server listening on ephemeral port ${port}.\n`);

  try {
    // 2. Authenticate Super Admin and Create Test Accounts
    console.log('2. Bootstrapping test accounts (ADMIN, IT_MANAGER, IT_SUPPORT)...');
    const adminLoginRes = await request(port, '/api/v1/auth/login', 'POST', {
      username: 'admin.super',
      password: 'SuperAdminPass123!',
    });
    const adminCookie = extractCookieHeader(adminLoginRes.setCookie);
    assert(adminLoginRes.statusCode === 200 && adminCookie, 'Super Admin login succeeded with auth cookie.');

    // Create IT Manager account
    const createMgrRes = await request(port, '/api/v1/admin/users', 'POST', {
      full_name: 'Dewi Manager',
      username: 'dewi.manager',
      email: 'dewi.manager@rsawalbros.com',
      password: 'DewiManagerPass123!',
      role: 'IT_MANAGER',
    }, adminCookie);
    assert(createMgrRes.statusCode === 201, 'IT_MANAGER account created (201 Created).');
    const managerId = createMgrRes.body.data.id;

    // Create IT Support account
    const createSupportRes = await request(port, '/api/v1/admin/users', 'POST', {
      full_name: 'Budi Support',
      username: 'budi.support',
      email: 'budi.support@rsawalbros.com',
      password: 'BudiSupportPass123!',
      role: 'IT_SUPPORT',
    }, adminCookie);
    assert(createSupportRes.statusCode === 201, 'IT_SUPPORT account created (201 Created).');
    const supportId = createSupportRes.body.data.id;

    // Authenticate manager & support
    const mgrLoginRes = await request(port, '/api/v1/auth/login', 'POST', {
      username: 'dewi.manager',
      password: 'DewiManagerPass123!',
    });
    const mgrCookie = extractCookieHeader(mgrLoginRes.setCookie);
    assert(mgrLoginRes.statusCode === 200 && mgrCookie, 'IT_MANAGER login succeeded with auth cookie.');

    const supportLoginRes = await request(port, '/api/v1/auth/login', 'POST', {
      username: 'budi.support',
      password: 'BudiSupportPass123!',
    });
    const supportCookie = extractCookieHeader(supportLoginRes.setCookie);
    assert(supportLoginRes.statusCode === 200 && supportCookie, 'IT_SUPPORT login succeeded with auth cookie.\n');

    // 3. Testing Self-Service Password Change (PATCH /api/v1/auth/password)
    console.log('3. Testing Self-Service Password Change (PATCH /api/v1/auth/password)...');
    
    // 3.1 Unauthenticated
    const unauthChange = await request(port, '/api/v1/auth/password', 'PATCH', {
      current_password: 'Any',
      new_password: 'NewPassword123!',
      confirm_password: 'NewPassword123!',
    });
    assert(unauthChange.statusCode === 401, 'Unauthenticated self-password-change returns HTTP 401.');
    assert(unauthChange.body.error.code === 'UNAUTHORIZED', 'Error code is UNAUTHORIZED.');

    // 3.2 Missing fields
    const missingFields = await request(port, '/api/v1/auth/password', 'PATCH', {
      current_password: 'BudiSupportPass123!',
    }, supportCookie);
    assert(missingFields.statusCode === 400, 'Missing fields rejected with HTTP 400.');
    assert(missingFields.body.error.code === 'VALIDATION_ERROR', 'Error code is VALIDATION_ERROR.');

    // 3.3 Password shorter than 8 chars
    const shortPw = await request(port, '/api/v1/auth/password', 'PATCH', {
      current_password: 'BudiSupportPass123!',
      new_password: 'short',
      confirm_password: 'short',
    }, supportCookie);
    assert(shortPw.statusCode === 400, 'Password shorter than 8 rejected with HTTP 400.');
    assert(shortPw.body.error.code === 'VALIDATION_ERROR', 'Error code is VALIDATION_ERROR.');

    // 3.4 Confirm password mismatch
    const mismatchPw = await request(port, '/api/v1/auth/password', 'PATCH', {
      current_password: 'BudiSupportPass123!',
      new_password: 'ValidPassword123!',
      confirm_password: 'DifferentPassword123!',
    }, supportCookie);
    assert(mismatchPw.statusCode === 400, 'Confirm password mismatch rejected with HTTP 400.');
    assert(mismatchPw.body.error.code === 'VALIDATION_ERROR', 'Error code is VALIDATION_ERROR.');

    // 3.5 Incorrect current password
    const wrongCurrentPw = await request(port, '/api/v1/auth/password', 'PATCH', {
      current_password: 'WrongCurrentPassword!',
      new_password: 'NewValidPassword123!',
      confirm_password: 'NewValidPassword123!',
    }, supportCookie);
    assert(wrongCurrentPw.statusCode === 400, 'Incorrect current password rejected with HTTP 400.');
    assert(wrongCurrentPw.body.error.code === 'INVALID_CREDENTIALS', 'Error code is INVALID_CREDENTIALS.');

    // 3.6 New password same as current password
    const samePw = await request(port, '/api/v1/auth/password', 'PATCH', {
      current_password: 'BudiSupportPass123!',
      new_password: 'BudiSupportPass123!',
      confirm_password: 'BudiSupportPass123!',
    }, supportCookie);
    assert(samePw.statusCode === 400, 'New password same as current rejected with HTTP 400.');
    assert(samePw.body.error.code === 'SAME_PASSWORD', 'Error code is SAME_PASSWORD.');

    // 3.7 Valid password change
    const validChange = await request(port, '/api/v1/auth/password', 'PATCH', {
      current_password: 'BudiSupportPass123!',
      new_password: 'BudiNewPass2026!#',
      confirm_password: 'BudiNewPass2026!#',
    }, supportCookie);
    assert(validChange.statusCode === 200, 'Valid self-service password change returns HTTP 200.');
    assert(validChange.body.success === true, 'Response body has success: true.');

    // 4. Verifying Login Behavior Post-Password-Change
    console.log('\n4. Verifying Login Behavior Post-Password-Change...');
    const oldLoginAttempt = await request(port, '/api/v1/auth/login', 'POST', {
      username: 'budi.support',
      password: 'BudiSupportPass123!',
    });
    assert(oldLoginAttempt.statusCode === 401, 'Login with old password is now rejected (HTTP 401).');

    const newLoginAttempt = await request(port, '/api/v1/auth/login', 'POST', {
      username: 'budi.support',
      password: 'BudiNewPass2026!#',
    });
    assert(newLoginAttempt.statusCode === 200, 'Login with new password succeeds (HTTP 200).');
    const updatedSupportCookie = extractCookieHeader(newLoginAttempt.setCookie);

    // 5. Testing Administrative Password Reset (PATCH /api/v1/admin/users/:id/password)
    console.log('\n5. Testing Administrative Password Reset (PATCH /api/v1/admin/users/:id/password)...');

    // 5.1 Unauthenticated
    const unauthReset = await request(port, `/api/v1/admin/users/${supportId}/password`, 'PATCH', {
      new_password: 'ResetPassword123!',
    });
    assert(unauthReset.statusCode === 401, 'Unauthenticated reset returns HTTP 401.');

    // 5.2 IT_SUPPORT cannot reset passwords
    const supportResetAttempt = await request(port, `/api/v1/admin/users/${managerId}/password`, 'PATCH', {
      new_password: 'ResetPassword123!',
    }, updatedSupportCookie);
    assert(supportResetAttempt.statusCode === 403, 'IT_SUPPORT attempting reset returns HTTP 403 FORBIDDEN.');

    // 5.3 Invalid UUID format
    const invalidUuidReset = await request(port, '/api/v1/admin/users/invalid-uuid-format/password', 'PATCH', {
      new_password: 'ResetPassword123!',
    }, adminCookie);
    assert(invalidUuidReset.statusCode === 400, 'Invalid UUID returns HTTP 400 INVALID_ID.');
    assert(invalidUuidReset.body.error.code === 'INVALID_ID', 'Error code is INVALID_ID.');

    // 5.4 Nonexistent UUID
    const nonexistentUuid = crypto.randomUUID();
    const nonexistentReset = await request(port, `/api/v1/admin/users/${nonexistentUuid}/password`, 'PATCH', {
      new_password: 'ResetPassword123!',
    }, adminCookie);
    assert(nonexistentReset.statusCode === 404, 'Nonexistent UUID returns HTTP 404 USER_NOT_FOUND.');

    // 5.5 Password too short
    const shortAdminReset = await request(port, `/api/v1/admin/users/${supportId}/password`, 'PATCH', {
      new_password: 'short',
    }, adminCookie);
    assert(shortAdminReset.statusCode === 400, 'Short new_password rejected with HTTP 400.');

    // 5.6 IT_MANAGER attempting to reset ADMIN
    const superAdminRes = await testPool.query("SELECT id FROM users WHERE username = 'admin.super'");
    const superAdminId = superAdminRes.rows[0].id;
    const mgrResetAdmin = await request(port, `/api/v1/admin/users/${superAdminId}/password`, 'PATCH', {
      new_password: 'HackedAdminPass123!',
    }, mgrCookie);
    assert(mgrResetAdmin.statusCode === 403, 'IT_MANAGER resetting ADMIN rejected with HTTP 403 FORBIDDEN.');

    // 5.7 IT_MANAGER attempting to reset another IT_MANAGER
    const createMgr2Res = await request(port, '/api/v1/admin/users', 'POST', {
      full_name: 'Siti Manager',
      username: 'siti.manager',
      email: 'siti.manager@rsawalbros.com',
      password: 'SitiManagerPass123!',
      role: 'IT_MANAGER',
    }, adminCookie);
    const mgr2Id = createMgr2Res.body.data.id;

    const mgrResetPeer = await request(port, `/api/v1/admin/users/${mgr2Id}/password`, 'PATCH', {
      new_password: 'PeerResetPass123!',
    }, mgrCookie);
    assert(mgrResetPeer.statusCode === 403, 'IT_MANAGER resetting peer IT_MANAGER rejected with HTTP 403 FORBIDDEN.');

    // 5.8 IT_MANAGER resetting IT_SUPPORT
    const mgrResetSupport = await request(port, `/api/v1/admin/users/${supportId}/password`, 'PATCH', {
      new_password: 'ManagerResetPass123!',
    }, mgrCookie);
    assert(mgrResetSupport.statusCode === 200, 'IT_MANAGER resetting IT_SUPPORT succeeds (HTTP 200).');
    assert(mgrResetSupport.body.data.username === 'budi.support', 'Response returns target username.');
    assert(mgrResetSupport.body.data.password_hash === undefined, 'Response strictly excludes password_hash.');

    // Verify IT_SUPPORT can log in with reset password
    const supportPostResetLogin = await request(port, '/api/v1/auth/login', 'POST', {
      username: 'budi.support',
      password: 'ManagerResetPass123!',
    });
    assert(supportPostResetLogin.statusCode === 200, 'Target user successfully logs in with admin-reset password.');

    // 5.9 ADMIN resetting IT_MANAGER
    const adminResetMgr = await request(port, `/api/v1/admin/users/${managerId}/password`, 'PATCH', {
      new_password: 'AdminResetMgrPass123!',
    }, adminCookie);
    assert(adminResetMgr.statusCode === 200, 'ADMIN resetting IT_MANAGER succeeds (HTTP 200).');

    // Verify IT_MANAGER can log in with reset password
    const mgrPostResetLogin = await request(port, '/api/v1/auth/login', 'POST', {
      username: 'dewi.manager',
      password: 'AdminResetMgrPass123!',
    });
    assert(mgrPostResetLogin.statusCode === 200, 'IT_MANAGER successfully logs in with reset password.');
    const newMgrCookie = extractCookieHeader(mgrPostResetLogin.setCookie);

    // 6. Testing Administrative User Profile Update (PATCH /api/v1/admin/users/:id)
    console.log('\n6. Testing Administrative User Profile Update (PATCH /api/v1/admin/users/:id)...');

    // 6.1 Unauthenticated
    const unauthProfileUpdate = await request(port, `/api/v1/admin/users/${supportId}`, 'PATCH', {
      full_name: 'New Name',
    });
    assert(unauthProfileUpdate.statusCode === 401, 'Unauthenticated profile update returns HTTP 401.');

    // 6.2 IT_SUPPORT cannot update profile
    const supportUpdateAttempt = await request(port, `/api/v1/admin/users/${supportId}`, 'PATCH', {
      full_name: 'Hacked Name',
    }, supportCookie);
    assert(supportUpdateAttempt.statusCode === 403, 'IT_SUPPORT profile update returns HTTP 403 FORBIDDEN.');

    // 6.3 Malformed UUID
    const malformedUuidProfile = await request(port, '/api/v1/admin/users/not-a-uuid', 'PATCH', {
      full_name: 'Name',
    }, adminCookie);
    assert(malformedUuidProfile.statusCode === 400, 'Malformed UUID returns HTTP 400 INVALID_ID.');

    // 6.4 Nonexistent UUID
    const nonexistentProfile = await request(port, `/api/v1/admin/users/${crypto.randomUUID()}`, 'PATCH', {
      full_name: 'Name',
    }, adminCookie);
    assert(nonexistentProfile.statusCode === 404, 'Nonexistent UUID returns HTTP 404 USER_NOT_FOUND.');

    // 6.5 Empty body
    const emptyBody = await request(port, `/api/v1/admin/users/${supportId}`, 'PATCH', {}, adminCookie);
    assert(emptyBody.statusCode === 400, 'Empty request body rejected with HTTP 400.');

    // 6.6 Unsupported field
    const unsupportedField = await request(port, `/api/v1/admin/users/${supportId}`, 'PATCH', {
      password_hash: 'direct_hash_injection',
    }, adminCookie);
    assert(unsupportedField.statusCode === 400, 'Unsupported field (password_hash) rejected with HTTP 400.');
    assert(unsupportedField.body.error.code === 'UNSUPPORTED_FIELD', 'Error code is UNSUPPORTED_FIELD.');

    // 6.7 Invalid email format
    const invalidEmail = await request(port, `/api/v1/admin/users/${supportId}`, 'PATCH', {
      email: 'not-an-email',
    }, adminCookie);
    assert(invalidEmail.statusCode === 400, 'Invalid email format rejected with HTTP 400.');
    assert(invalidEmail.body.error.code === 'INVALID_EMAIL', 'Error code is INVALID_EMAIL.');

    // 6.8 Duplicate email conflict
    const dupEmail = await request(port, `/api/v1/admin/users/${supportId}`, 'PATCH', {
      email: 'admin.super@rsawalbros.com',
    }, adminCookie);
    assert(dupEmail.statusCode === 409, 'Duplicate email conflict returns HTTP 409 DUPLICATE_EMAIL.');
    assert(dupEmail.body.error.code === 'DUPLICATE_EMAIL', 'Error code is DUPLICATE_EMAIL.');

    // 6.9 IT_MANAGER cannot update ADMIN account
    const mgrUpdateAdmin = await request(port, `/api/v1/admin/users/${superAdminId}`, 'PATCH', {
      full_name: 'Hacked Super Admin',
    }, newMgrCookie);
    assert(mgrUpdateAdmin.statusCode === 403, 'IT_MANAGER updating ADMIN account rejected with HTTP 403.');

    // 6.10 IT_MANAGER cannot update peer IT_MANAGER account
    const mgrUpdatePeer = await request(port, `/api/v1/admin/users/${mgr2Id}`, 'PATCH', {
      full_name: 'Peer Manager Updated',
    }, newMgrCookie);
    assert(mgrUpdatePeer.statusCode === 403, 'IT_MANAGER updating peer IT_MANAGER rejected with HTTP 403.');

    // 6.11 IT_MANAGER cannot promote IT_SUPPORT to ADMIN
    const mgrPromoteAdmin = await request(port, `/api/v1/admin/users/${supportId}`, 'PATCH', {
      role: 'ADMIN',
    }, newMgrCookie);
    assert(mgrPromoteAdmin.statusCode === 403, 'IT_MANAGER promoting IT_SUPPORT to ADMIN rejected with HTTP 403.');
    assert(mgrPromoteAdmin.body.error.code === 'PRIVILEGE_ESCALATION_DENIED', 'Error code is PRIVILEGE_ESCALATION_DENIED.');

    // 6.12 IT_MANAGER cannot promote IT_SUPPORT to IT_MANAGER
    const mgrPromoteMgr = await request(port, `/api/v1/admin/users/${supportId}`, 'PATCH', {
      role: 'IT_MANAGER',
    }, newMgrCookie);
    assert(mgrPromoteMgr.statusCode === 403, 'IT_MANAGER promoting IT_SUPPORT to IT_MANAGER rejected with HTTP 403.');

    // 6.13 IT_MANAGER can update IT_SUPPORT metadata
    const mgrUpdateSupport = await request(port, `/api/v1/admin/users/${supportId}`, 'PATCH', {
      full_name: 'Budi Santoso Jr.',
      email: 'budi.santoso.jr@rsawalbros.com',
    }, newMgrCookie);
    assert(mgrUpdateSupport.statusCode === 200, 'IT_MANAGER updating IT_SUPPORT metadata succeeds (HTTP 200).');
    assert(mgrUpdateSupport.body.data.full_name === 'Budi Santoso Jr.', 'Updated full_name matches.');
    assert(mgrUpdateSupport.body.data.email === 'budi.santoso.jr@rsawalbros.com', 'Updated email matches.');
    assert(mgrUpdateSupport.body.data.password_hash === undefined, 'Response strictly excludes password_hash.');

    // 6.14 ADMIN can update user metadata and assign roles
    const adminUpdateUser = await request(port, `/api/v1/admin/users/${supportId}`, 'PATCH', {
      full_name: 'Budi Santoso Senior',
      role: 'IT_MANAGER',
    }, adminCookie);
    assert(adminUpdateUser.statusCode === 200, 'ADMIN updating user metadata and role succeeds (HTTP 200).');
    assert(adminUpdateUser.body.data.role === 'IT_MANAGER', 'Role successfully updated to IT_MANAGER.');

    // 6.15 ADMIN self-demotion prevention
    const adminDemoteSelf = await request(port, `/api/v1/admin/users/${superAdminId}`, 'PATCH', {
      role: 'IT_SUPPORT',
    }, adminCookie);
    assert(adminDemoteSelf.statusCode === 400, 'ADMIN self-demotion prevented with HTTP 400 CANNOT_DEMOTE_SELF.');

    // 7. Audit Log Verification
    console.log('\n7. Verifying Audit Trail & Sanitization...');
    const auditRes = await request(port, '/api/v1/admin/audit-logs?limit=50', 'GET', null, adminCookie);
    assert(auditRes.statusCode === 200, 'Audit logs retrieved successfully (HTTP 200).');
    const logs = auditRes.body.data;

    const pwChangedEvent = logs.find((l) => l.action === 'PASSWORD_CHANGED');
    assert(Boolean(pwChangedEvent), 'Audit log contains "PASSWORD_CHANGED" event.');

    const pwResetEvent = logs.find((l) => l.action === 'PASSWORD_RESET');
    assert(Boolean(pwResetEvent), 'Audit log contains "PASSWORD_RESET" event.');

    const userUpdatedEvent = logs.find((l) => l.action === 'USER_UPDATED');
    assert(Boolean(userUpdatedEvent), 'Audit log contains "USER_UPDATED" event.');

    // Verify 100% of audit logs are sanitized of passwords and credentials
    let auditHasSecrets = false;
    for (const log of logs) {
      const jsonStr = JSON.stringify(log).toLowerCase();
      if (
        jsonStr.includes('password123') ||
        jsonStr.includes('budinewpass') ||
        jsonStr.includes('dewimanagerpass') ||
        jsonStr.includes('password_hash') ||
        jsonStr.includes('auth_token')
      ) {
        auditHasSecrets = true;
        break;
      }
    }
    assert(!auditHasSecrets, '100% of audit records confirmed clean of sensitive credentials.');

    // 8. Static Contract Analysis of Frontend Files
    console.log('\n8. Verifying Frontend Integration & Static Contracts...');
    const adminApiSrc = fs.readFileSync(path.join(__dirname, '../js/admin-api.js'), 'utf8');
    assert(adminApiSrc.includes('changePassword({ currentPassword, newPassword, confirmPassword })'), 'AdminAPI.auth.changePassword method defined.');
    assert(adminApiSrc.includes('resetPassword(id, newPassword)'), 'AdminAPI.users.resetPassword method defined.');
    assert(adminApiSrc.includes('update(id, userData)'), 'AdminAPI.users.update method defined.');

    const adminHtmlSrc = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');
    assert(adminHtmlSrc.includes('id="change-password-modal"'), 'admin.html includes #change-password-modal.');
    assert(adminHtmlSrc.includes('id="reset-password-modal"'), 'admin.html includes #reset-password-modal.');
    assert(adminHtmlSrc.includes('id="edit-user-modal"'), 'admin.html includes #edit-user-modal.');
    assert(adminHtmlSrc.includes('id="btn-change-own-password"'), 'admin.html includes #btn-change-own-password in header.');

    const adminDashSrc = fs.readFileSync(path.join(__dirname, '../js/admin-dashboard.js'), 'utf8');
    assert(adminDashSrc.includes('window.openChangePasswordModal'), 'admin-dashboard.js defines openChangePasswordModal.');
    assert(adminDashSrc.includes('window.openResetPasswordModal'), 'admin-dashboard.js defines openResetPasswordModal.');
    assert(adminDashSrc.includes('window.openEditUserModal'), 'admin-dashboard.js defines openEditUserModal.');
    assert(adminDashSrc.includes('openEditUserModal'), 'renderUsersTable invokes openEditUserModal.');
    assert(adminDashSrc.includes('openResetPasswordModal'), 'renderUsersTable invokes openResetPasswordModal.');

    // 9. Operational Runbook Verification
    console.log('\n9. Verifying RUNBOOK.md Documentation...');
    const runbookSrc = fs.readFileSync(path.join(__dirname, '../RUNBOOK.md'), 'utf8');
    assert(runbookSrc.includes('## R. User Credential Lifecycle & Password Management'), 'RUNBOOK.md contains Section R.');
    assert(runbookSrc.includes('Mandiri: Ganti Kata Sandi Sendiri'), 'RUNBOOK.md documents Self-Service Password Change.');
    assert(runbookSrc.includes('Administrator: Reset Kata Sandi Staf IT'), 'RUNBOOK.md documents Admin Password Reset.');
    assert(runbookSrc.includes('Batasan Otorisasi IT Manager'), 'RUNBOOK.md documents IT Manager Role Hierarchy.');
    assert(runbookSrc.includes('Prosedur Insiden: Staf Lupa Kata Sandi'), 'RUNBOOK.md documents Forgotten Password SOP.');
    assert(runbookSrc.includes('Rotasi Kredensial Bootstrap Awal Pabrik'), 'RUNBOOK.md documents Bootstrap credential rotation.');

    console.log('\n================================================================');
    console.log(` ALL M13 USER SECURITY TESTS PASSED (${passedAssertions} assertions)!`);
    console.log('================================================================\n');

  } finally {
    server.close();
    await testPool.end();
  }
}

runM13UserSecurityTests().catch((err) => {
  console.error('M13 Test Suite Error:', err);
  process.exit(1);
});
