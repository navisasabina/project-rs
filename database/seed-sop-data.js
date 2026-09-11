/**
 * Seed Script: seed-sop-data.js
 * 
 * Migrates all 8 SOP master data records from js/sop-data.js into PostgreSQL
 * (categories, guides, guide_steps) idempotently using ON CONFLICT DO UPDATE.
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../server/config/database');

// Deterministic system author identity for initial seeding (before Admin Auth is built)
const SYSTEM_SEED_AUTHOR = {
  id: '00000000-0000-0000-0000-000000000001',
  full_name: 'Sistem IT RS Awal Bros',
  username: 'system_seed',
  email: 'system.seed@awalbros.com',
  password_hash: '$2b$12$SYSTEM_INITIAL_SEED_AUTHOR_NO_LOGIN_ACCESS',
  role: 'ADMIN',
};

// Explicit Category Metadata Mapping based on approved UI Directory (ViewCategories)
const CATEGORY_DEFINITIONS = {
  'Aplikasi & Browser': {
    name: 'Aplikasi & Browser',
    slug: 'aplikasi-browser',
    icon: 'sync',
    description: 'Pembersihan berkas cache, cookies riwayat sesi akun perawat/dokter, dan optimasi pemakaian memori RAM browser SIMRS.',
    display_order: 1,
  },
  'Jaringan & Port': {
    name: 'Jaringan & Port',
    slug: 'jaringan-port',
    icon: 'lan',
    description: 'Kabel patch cord RJ45 CAT6, pelat soket data dinding ICU/OK, switch hub ruangan, dan akses poin WiFi medis.',
    display_order: 2,
  },
  'Farmasi & Kasir': {
    name: 'Farmasi & Kasir',
    slug: 'farmasi-kasir',
    icon: 'print',
    description: 'Printer stiker etiket farmasi, barcode wristband gelang pasien IGD, dan dokumen resep rangkap.',
    display_order: 3,
  },
  'Hardware PC': {
    name: 'Hardware PC',
    slug: 'hardware-pc',
    icon: 'desktop_windows',
    description: 'Komputer rawat inap, CPU nurse station, stopkontak UPS, dan penanganan desktop mati total.',
    display_order: 4,
  },
  'Layar Display': {
    name: 'Layar Display',
    slug: 'layar-display',
    icon: 'desktop_windows',
    description: 'Monitor ruang operasi, kabel display HDMI/VGA, dan penanganan layar no signal/blank.',
    display_order: 5,
  },
  'Aksesoris USB': {
    name: 'Aksesoris USB',
    slug: 'aksesoris-usb',
    icon: 'mouse',
    description: 'Keyboard, mouse, sensor optik, kabel USB, dan barcode scanner rekam medis.',
    display_order: 6,
  },
  'Meja Dokter': {
    name: 'Meja Dokter',
    slug: 'meja-dokter',
    icon: 'desktop_windows',
    description: 'Mini PC bracket bawah meja praktek dokter spesialis, adaptor 19V, dan ventilasi pendingin.',
    display_order: 7,
  },
  'Keamanan Fisik': {
    name: 'Keamanan Fisik',
    slug: 'keamanan-fisik',
    icon: 'videocam',
    description: 'Kamera CCTV dome koridor pasien, switch PoE, dan kamera pemantau ruangan.',
    display_order: 8,
  },
};

// Search keywords mapped directly from index.html cards for each key_code
const GUIDE_KEYWORDS_MAPPING = {
  cache: 'komputer lambat cache menumpuk browser aplikasi relog chrome lemot hang poliklinik farmasi administrasi',
  lan: 'internet tidak terhubung lan terlepas kabel rj45 offline bola dunia silang merah disconnect nurse station dialisis kantor',
  printer: 'printer tidak berfungsi resep macet thermal stiker etiket blink merah kertas habis kasir screening farmasi',
  power: 'pc komputer tidak menyala mati total cpu desktop saklar stopkontak power customer care nicu meja perawat',
  monitor: 'monitor tidak ada sinyal no signal blank layar hitam kabel hdmi vga kendor pendaftaran kasir ruang operasi ok',
  mouse: 'keyboard mouse bermasalah macet kursor hilang usb port screening e nurse station',
  minipc: 'mini pc ruang periksa meja dokter bracket onlogic adaptor kendor klinik spesialis poli kecantikan periksa',
  cctv: 'kamera cctv tidak terdeteksi offline koridor plafon poe ip camera koridor ruang rawat vip area parkir',
};

// Possible causes extracted directly from symptoms & SOP context
const GUIDE_POSSIBLE_CAUSES_MAPPING = {
  cache: 'Tab browser menumpuk berminggu-minggu, cache & cookies kadaluarsa, memory leak browser SIMRS.',
  lan: 'Kabel patch cord RJ45 kendor di belakang PC atau wallplate dinding, port switch ruangan terputus.',
  printer: 'Paper jam pada thermal roll, sensor optik tertutup serpihan kertas label, cover belum terkunci rapat.',
  power: 'Kabel AC 3-lubang kendor, saklar UPS cadangan belum aktif, arus sisa pada kapasitor PSU.',
  monitor: 'Kabel HDMI/VGA kendor di sasis PC atau monitor, mode input source keliru (VGA vs HDMI).',
  mouse: 'Port USB depan kekurangan daya, sensor optik kotor, mousepad tidak rata atau baterai nirkabel habis.',
  minipc: 'Adaptor 19V kendor akibat tersenggol di bawah meja, saklar terminal mati, sasis pendingin tertutup.',
  cctv: 'Kabel LAN PoE koridor kendor, port managed switch di ruang server perlu restart daya, kabel plafon tertarik.',
};

/**
 * Reads SOP_DATABASE directly from js/sop-data.js without altering the file
 */
function readSourceSOPData() {
  const sopFilePath = path.resolve(__dirname, '../js/sop-data.js');
  const fileContent = fs.readFileSync(sopFilePath, 'utf8');

  // Safely evaluate SOP_DATABASE object in isolated sandbox
  const sandbox = {};
  const fn = new Function('sandbox', `${fileContent}; sandbox.SOP_DATABASE = SOP_DATABASE;`);
  fn(sandbox);

  if (!sandbox.SOP_DATABASE) {
    throw new Error('Could not parse SOP_DATABASE from js/sop-data.js');
  }

  return sandbox.SOP_DATABASE;
}

/**
 * Seeds all SOP data into PostgreSQL idempotently and safely.
 * By default (safe mode), existing guides are preserved to protect administrative edits.
 * Pass --force (or options.force = true / FORCE_SEED=true) to intentionally overwrite baseline records.
 */
async function seedSOPData(targetPool = pool, options = {}) {
  const client = await targetPool.connect();
  const sourceSOP = readSourceSOPData();
  const sopKeys = Object.keys(sourceSOP);

  const isForce = (typeof options === 'object' && options.force === true) ||
    process.argv.includes('--force') ||
    process.env.FORCE_SEED === 'true';

  if (isForce) {
    console.log('[Seed SOP] Mode: FORCE (penimpaan master template aktif).');
  } else {
    console.log('[Seed SOP] Mode: SAFE / NON-DESTRUCTIVE (mempertahankan panduan yang sudah ada).');
  }

  console.log(`[Seed SOP] Ditemukan ${sopKeys.length} modul SOP dalam js/sop-data.js.`);

  try {
    await client.query('BEGIN');

    // 1. Seed System Author (Idempotent)
    await client.query(`
      INSERT INTO users (id, full_name, username, email, password_hash, role, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      ON CONFLICT (username) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        updated_at = CURRENT_TIMESTAMP;
    `, [
      SYSTEM_SEED_AUTHOR.id,
      SYSTEM_SEED_AUTHOR.full_name,
      SYSTEM_SEED_AUTHOR.username,
      SYSTEM_SEED_AUTHOR.email,
      SYSTEM_SEED_AUTHOR.password_hash,
      SYSTEM_SEED_AUTHOR.role,
    ]);

    // Retrieve system author ID in case of existing username
    const authorRes = await client.query('SELECT id FROM users WHERE username = $1', [SYSTEM_SEED_AUTHOR.username]);
    const authorId = authorRes.rows[0].id;

    // 2. Seed Categories (Idempotent)
    const categoryIdMap = new Map();
    for (const [categoryName, def] of Object.entries(CATEGORY_DEFINITIONS)) {
      const catRes = await client.query(`
        INSERT INTO categories (name, slug, icon, description, display_order, is_active)
        VALUES ($1, $2, $3, $4, $5, TRUE)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          icon = EXCLUDED.icon,
          description = EXCLUDED.description,
          display_order = EXCLUDED.display_order,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id, name;
      `, [def.name, def.slug, def.icon, def.description, def.display_order]);

      categoryIdMap.set(categoryName, catRes.rows[0].id);
    }
    console.log(`[Seed SOP] Diverifikasi ${categoryIdMap.size} kategori.`);

    // 3. Seed Guides and Steps
    let seededGuideCount = 0;
    let seededStepCount = 0;

    for (const key of sopKeys) {
      const item = sourceSOP[key];
      const categoryId = categoryIdMap.get(item.category);

      if (!categoryId) {
        throw new Error(`Category "${item.category}" for SOP "${key}" not found in category map!`);
      }

      const keywords = GUIDE_KEYWORDS_MAPPING[key] || '';
      const possibleCauses = GUIDE_POSSIBLE_CAUSES_MAPPING[key] || '';

      const steps = [
        { number: 1, title: item.step1Title, instruction: item.step1Desc },
        { number: 2, title: item.step2Title, instruction: item.step2Desc },
        { number: 3, title: item.step3Title, instruction: item.step3Desc },
      ];

      // If NOT in force mode, check if guide already exists
      if (!isForce) {
        const existingRes = await client.query(
          'SELECT id, title, status FROM guides WHERE key_code = $1',
          [item.key]
        );

        if (existingRes.rows.length > 0) {
          const existingGuide = existingRes.rows[0];
          console.log(`[Seed SOP] Panduan "${key}" (${existingGuide.title}) sudah ada. Melewati (modifikasi admin dipertahankan).`);
          seededGuideCount++;
          const stepsRes = await client.query(
            'SELECT count(*) as c FROM guide_steps WHERE guide_id = $1',
            [existingGuide.id]
          );
          seededStepCount += parseInt(stepsRes.rows[0].c, 10);
          continue;
        }
      }

      // Insert or Force Update Guide
      const guideRes = await client.query(`
        INSERT INTO guides (
          category_id,
          author_id,
          key_code,
          title,
          location_scope,
          image_url,
          estimated_time,
          symptoms,
          possible_causes,
          security_note,
          prompt_shortcut,
          status,
          keywords,
          published_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, '2 - 4 Menit', $7, $8, $9, $10, 'PUBLISHED', $11, CURRENT_TIMESTAMP
        )
        ON CONFLICT (key_code) DO UPDATE SET
          category_id = EXCLUDED.category_id,
          title = EXCLUDED.title,
          location_scope = EXCLUDED.location_scope,
          image_url = EXCLUDED.image_url,
          symptoms = EXCLUDED.symptoms,
          possible_causes = EXCLUDED.possible_causes,
          security_note = EXCLUDED.security_note,
          prompt_shortcut = EXCLUDED.prompt_shortcut,
          status = 'PUBLISHED',
          keywords = EXCLUDED.keywords,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id;
      `, [
        categoryId,
        authorId,
        item.key,
        item.title,
        item.location,
        item.image,
        JSON.stringify(item.symptoms || []),
        possibleCauses,
        item.securityNote,
        item.prompt,
        keywords,
      ]);

      const guideId = guideRes.rows[0].id;
      seededGuideCount++;

      // Clean existing steps for this guide only if forcing or inserting
      await client.query('DELETE FROM guide_steps WHERE guide_id = $1', [guideId]);

      for (const step of steps) {
        await client.query(`
          INSERT INTO guide_steps (guide_id, step_number, title, instruction)
          VALUES ($1, $2, $3, $4);
        `, [guideId, step.number, step.title, step.instruction]);
        seededStepCount++;
      }
    }

    await client.query('COMMIT');
    console.log(`[Seed SOP] Selesai: ${seededGuideCount} modul panduan dan ${seededStepCount} langkah terverifikasi.`);

    return {
      guidesCount: seededGuideCount,
      stepsCount: seededStepCount,
      categoriesCount: categoryIdMap.size,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Seed SOP] Transaction failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// CLI Execution if run directly: node database/seed-sop-data.js
if (require.main === module) {
  (async () => {
    try {
      await seedSOPData();
      await pool.end();
      console.log('[Seed SOP] Finished successfully.');
      process.exit(0);
    } catch (err) {
      await pool.end().catch(() => {});
      console.error('[Seed SOP] Error:', err);
      process.exit(1);
    }
  })();
}

module.exports = {
  seedSOPData,
  readSourceSOPData,
  CATEGORY_DEFINITIONS,
  SYSTEM_SEED_AUTHOR,
};
