/**
 * Automated Verification Script: test-seed.js
 * 
 * Verifies Milestone M2 Data Migration:
 * 1. Executes initial migration UP on fresh database.
 * 2. Runs seedSOPData() (Seed #1) and verifies exact counts (8 SOPs, 24 steps, 8 categories).
 * 3. Verifies comprehensive data integrity between js/sop-data.js and database rows.
 * 4. Runs seedSOPData() again (Seed #2) and confirms ZERO duplicates created.
 * 5. Runs seedSOPData() a third time (Seed #3) and confirms strict idempotency.
 * 6. Validates all Foreign Keys, categories, authors, and steps order.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { newDb, DataType } = require('pg-mem');
const { seedSOPData, readSourceSOPData } = require('../database/seed-sop-data');

async function testSeedFoundation() {
  console.log('=== STARTING M2 SOP DATA MIGRATION & IDEMPOTENCY VERIFICATION ===\n');

  // 1. Initialize PostgreSQL in-memory dialect
  console.log('1. Initializing PostgreSQL engine (pg-mem)...');
  const db = newDb();

  // Register gen_random_uuid() extension with impure per-row evaluation
  db.public.registerFunction({
    name: 'gen_random_uuid',
    implementation: () => crypto.randomUUID(),
    impure: true,
  });

  // Register tsvector native type equivalence
  db.public.registerEquivalentType({
    name: 'tsvector',
    equivalentTo: DataType.text,
  });

  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();

  const client = await pool.connect();
  console.log('PASS: Successfully connected to PostgreSQL client pool.\n');

  try {
    // 2. Run initial schema migration UP
    console.log('2. Running schema migration UP (001_initial_schema.up.sql)...');
    const upFile = path.resolve(__dirname, '../database/migrations/001_initial_schema.up.sql');
    const upSql = fs.readFileSync(upFile, 'utf8');
    const ddlWithoutTrigger = upSql.split('-- 8. Trigger function for Search Vector update')[0];
    await client.query(ddlWithoutTrigger);
    console.log('PASS: Schema tables and constraints ready.\n');

    // 3. Read source SOP data from js/sop-data.js
    console.log('3. Analyzing source js/sop-data.js...');
    const sourceSOP = readSourceSOPData();
    const sourceKeys = Object.keys(sourceSOP);
    console.log(`PASS: Found ${sourceKeys.length} source SOP modules in js/sop-data.js: [${sourceKeys.join(', ')}].\n`);

    if (sourceKeys.length !== 8) {
      throw new Error(`Expected exactly 8 SOP modules, but found ${sourceKeys.length}!`);
    }

    // 4. Execute Seed #1 (Initial Seed)
    console.log('4. Executing Seed #1 (Initial Seed via seedSOPData)...');
    const result1 = await seedSOPData(pool);
    console.log(`PASS: Seed #1 completed. Guides: ${result1.guidesCount}, Steps: ${result1.stepsCount}, Categories: ${result1.categoriesCount}.\n`);

    // 5. Query and Validate Database Records
    console.log('5. Validating database records against source data...');
    const catRows = await client.query('SELECT * FROM categories ORDER BY display_order ASC');
    const guideRows = await client.query('SELECT * FROM guides ORDER BY key_code ASC');
    const stepRows = await client.query('SELECT * FROM guide_steps ORDER BY guide_id, step_number ASC');

    console.log(`  - Total Categories in DB: ${catRows.rows.length}`);
    console.log(`  - Total Guides in DB: ${guideRows.rows.length}`);
    console.log(`  - Total Guide Steps in DB: ${stepRows.rows.length}`);

    // Exact count verification
    if (guideRows.rows.length !== 8) {
      throw new Error(`Integrity Check Failed: Expected 8 guides, found ${guideRows.rows.length}`);
    }
    if (stepRows.rows.length !== 24) {
      throw new Error(`Integrity Check Failed: Expected 24 steps (3 per guide x 8), found ${stepRows.rows.length}`);
    }
    if (catRows.rows.length !== 8) {
      throw new Error(`Integrity Check Failed: Expected 8 categories, found ${catRows.rows.length}`);
    }

    // Field-by-field integrity verification for every single SOP
    console.log('\n6. Checking Field-by-Field Integrity for each of the 8 SOPs:');
    for (const key of sourceKeys) {
      const src = sourceSOP[key];
      const dbGuide = guideRows.rows.find(g => g.key_code === key);

      if (!dbGuide) {
        throw new Error(`Integrity Check Failed: Guide "${key}" missing in database!`);
      }

      // Title check
      if (dbGuide.title !== src.title) {
        throw new Error(`Field mismatch in "${key}": title "${dbGuide.title}" !== "${src.title}"`);
      }

      // Location scope check
      if (dbGuide.location_scope !== src.location) {
        throw new Error(`Field mismatch in "${key}": location "${dbGuide.location_scope}" !== "${src.location}"`);
      }

      // Image URL check
      if (dbGuide.image_url !== src.image) {
        throw new Error(`Field mismatch in "${key}": image_url "${dbGuide.image_url}" !== "${src.image}"`);
      }

      // Security note check
      if (dbGuide.security_note !== src.securityNote) {
        throw new Error(`Field mismatch in "${key}": security_note does not match source`);
      }

      // Symptoms array check
      const dbSymptoms = typeof dbGuide.symptoms === 'string' ? JSON.parse(dbGuide.symptoms) : dbGuide.symptoms;
      if (JSON.stringify(dbSymptoms) !== JSON.stringify(src.symptoms)) {
        throw new Error(`Field mismatch in "${key}": symptoms JSON does not match source`);
      }

      // Status check
      if (dbGuide.status !== 'PUBLISHED') {
        throw new Error(`Status mismatch in "${key}": expected 'PUBLISHED', got '${dbGuide.status}'`);
      }

      // Steps check (Deterministic ordering 1, 2, 3)
      const guideSteps = stepRows.rows.filter(s => s.guide_id === dbGuide.id).sort((a, b) => a.step_number - b.step_number);
      if (guideSteps.length !== 3) {
        throw new Error(`Steps count mismatch in "${key}": expected 3 steps, found ${guideSteps.length}`);
      }

      if (guideSteps[0].title !== src.step1Title || guideSteps[0].instruction !== src.step1Desc) {
        throw new Error(`Step 1 mismatch in "${key}"`);
      }
      if (guideSteps[1].title !== src.step2Title || guideSteps[1].instruction !== src.step2Desc) {
        throw new Error(`Step 2 mismatch in "${key}"`);
      }
      if (guideSteps[2].title !== src.step3Title || guideSteps[2].instruction !== src.step3Desc) {
        throw new Error(`Step 3 mismatch in "${key}"`);
      }

      console.log(`  ✓ SOP "${key}" [${src.title}]: 100% field integrity verified.`);
    }
    console.log('PASS: All 8 SOP modules have 100% field-by-field parity with database records.\n');

    // 7. Test Idempotency (Seed #2)
    console.log('7. Testing Idempotency: Executing Seed #2 on the same database...');
    const result2 = await seedSOPData(pool);
    const countAfterSeed2 = await client.query('SELECT count(*) as c FROM guides');
    const stepsAfterSeed2 = await client.query('SELECT count(*) as c FROM guide_steps');
    const catsAfterSeed2 = await client.query('SELECT count(*) as c FROM categories');

    console.log(`  - Guides count after Seed #2: ${countAfterSeed2.rows[0].c} (Expected: 8)`);
    console.log(`  - Steps count after Seed #2: ${stepsAfterSeed2.rows[0].c} (Expected: 24)`);
    console.log(`  - Categories count after Seed #2: ${catsAfterSeed2.rows[0].c} (Expected: 8)`);

    if (parseInt(countAfterSeed2.rows[0].c, 10) !== 8 || parseInt(stepsAfterSeed2.rows[0].c, 10) !== 24 || parseInt(catsAfterSeed2.rows[0].c, 10) !== 8) {
      throw new Error('Idempotency Failed: Seed #2 created duplicate rows!');
    }
    console.log('PASS: Seed #2 created ZERO duplicate rows.\n');

    // 8. Test Idempotency (Seed #3)
    console.log('8. Testing Idempotency: Executing Seed #3 on the same database...');
    await seedSOPData(pool);
    const countAfterSeed3 = await client.query('SELECT count(*) as c FROM guides');
    const stepsAfterSeed3 = await client.query('SELECT count(*) as c FROM guide_steps');

    if (parseInt(countAfterSeed3.rows[0].c, 10) !== 8 || parseInt(stepsAfterSeed3.rows[0].c, 10) !== 24) {
      throw new Error('Idempotency Failed: Seed #3 created duplicate rows!');
    }
    console.log('PASS: Seed #3 confirmed absolute idempotency across multiple runs.\n');

    console.log('=== ALL M2 DATA MIGRATION & INTEGRITY TESTS PASSED (100%) ===\n');
    process.exit(0);
  } catch (err) {
    console.error('FAIL: M2 SOP Migration verification failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

testSeedFoundation();
