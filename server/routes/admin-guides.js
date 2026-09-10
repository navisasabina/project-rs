/**
 * Admin Guides & Steps Management Routes
 * 
 * Implements:
 * - GET    /api/v1/admin/guides             (List guides with category & author details across all statuses)
 * - GET    /api/v1/admin/guides/:id         (Detail of guide with full steps and metadata)
 * - POST   /api/v1/admin/guides             (Create guide with deterministic key_code and optional steps)
 * - PATCH  /api/v1/admin/guides/:id         (Update guide metadata)
 * - PATCH  /api/v1/admin/guides/:id/status  (Lifecycle transitions: DRAFT -> PUBLISHED -> ARCHIVED)
 * - PUT    /api/v1/admin/guides/:id/steps   (Replace / update guide steps sequentially)
 * 
 * Role & Security Boundaries:
 * - Requires authentication (requireAuth)
 * - ADMIN & IT_MANAGER: Full management (create, update, steps, lifecycle)
 * - IT_SUPPORT: Read-only access (GET only, mutations rejected with 403)
 * - Atomic database transactions for multi-row mutations
 * - Audit logging for all actions
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { recordAuditLog } = require('../services/auth');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_CODE_REGEX = /^[a-zA-Z0-9_-]{2,50}$/;
const ALLOWED_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

/**
 * Helper to generate URL-safe deterministic slug / key_code
 */
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * GET /api/v1/admin/guides
 * Protected: ADMIN, IT_MANAGER, IT_SUPPORT
 * Lists all guides across statuses (DRAFT, PUBLISHED, ARCHIVED)
 * Query parameters: ?status=... & ?category=...
 */
router.get('/', requireAuth, requireRoles('ADMIN', 'IT_MANAGER', 'IT_SUPPORT'), async (req, res) => {
  try {
    const { status, category } = req.query;

    const queryParams = [];
    let queryText = `
      SELECT 
        g.id,
        g.key_code,
        g.title,
        g.location_scope,
        g.image_url,
        g.estimated_time,
        g.user_description,
        g.symptoms,
        g.possible_causes,
        g.security_note,
        g.prompt_shortcut,
        g.status,
        g.keywords,
        g.published_at,
        g.created_at,
        g.updated_at,
        c.id AS category_id,
        c.name AS category_name,
        c.slug AS category_slug,
        c.icon AS category_icon,
        c.is_active AS category_is_active,
        u.id AS author_id,
        u.full_name AS author_name,
        u.username AS author_username,
        COUNT(gs.id)::int AS step_count
      FROM guides g
      JOIN categories c ON c.id = g.category_id
      JOIN users u ON u.id = g.author_id
      LEFT JOIN guide_steps gs ON gs.guide_id = g.id
      WHERE 1=1
    `;

    if (status) {
      const upperStatus = String(status).trim().toUpperCase();
      if (!ALLOWED_STATUSES.includes(upperStatus)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_QUERY_PARAMETER',
            message: `Parameter status tidak valid. Pilihan: ${ALLOWED_STATUSES.join(', ')}.`,
          },
        });
      }
      queryParams.push(upperStatus);
      queryText += ` AND g.status = $${queryParams.length}`;
    }

    if (category) {
      const trimmedCategory = String(category).trim();
      queryParams.push(trimmedCategory);
      if (UUID_REGEX.test(trimmedCategory)) {
        queryText += ` AND c.id = $${queryParams.length}`;
      } else {
        queryText += ` AND c.slug = $${queryParams.length}`;
      }
    }

    queryText += `
      GROUP BY g.id, c.id, u.id
      ORDER BY g.updated_at DESC, g.title ASC;
    `;

    const result = await db.query(queryText, queryParams);

    const guides = result.rows.map((row) => ({
      id: row.id,
      key_code: row.key_code,
      title: row.title,
      location_scope: row.location_scope,
      image_url: row.image_url,
      estimated_time: row.estimated_time,
      user_description: row.user_description,
      symptoms: typeof row.symptoms === 'string' ? JSON.parse(row.symptoms) : row.symptoms,
      possible_causes: row.possible_causes,
      security_note: row.security_note,
      prompt_shortcut: row.prompt_shortcut,
      status: row.status,
      keywords: row.keywords,
      published_at: row.published_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      step_count: row.step_count,
      category: {
        id: row.category_id,
        name: row.category_name,
        slug: row.category_slug,
        icon: row.category_icon,
        is_active: row.category_is_active,
      },
      author: {
        id: row.author_id,
        full_name: row.author_name,
        username: row.author_username,
      },
    }));

    return res.status(200).json({
      success: true,
      data: guides,
      meta: {
        count: guides.length,
      },
    });
  } catch (err) {
    console.error('[Admin Guides Error - GET /]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat mengambil daftar panduan.',
      },
    });
  }
});

/**
 * GET /api/v1/admin/guides/:id
 * Protected: ADMIN, IT_MANAGER, IT_SUPPORT
 * Retrieves full guide detail with category, author, and all steps ordered sequentially
 */
router.get('/:id', requireAuth, requireRoles('ADMIN', 'IT_MANAGER', 'IT_SUPPORT'), async (req, res) => {
  try {
    const { id } = req.params;

    const isUuid = UUID_REGEX.test(id);
    const isKeyCode = KEY_CODE_REGEX.test(id);

    if (!isUuid && !isKeyCode) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_IDENTIFIER',
          message: 'Format identifier panduan tidak valid.',
        },
      });
    }

    const guideQuery = `
      SELECT 
        g.id,
        g.key_code,
        g.title,
        g.location_scope,
        g.image_url,
        g.estimated_time,
        g.user_description,
        g.symptoms,
        g.possible_causes,
        g.security_note,
        g.prompt_shortcut,
        g.status,
        g.keywords,
        g.published_at,
        g.created_at,
        g.updated_at,
        c.id AS category_id,
        c.name AS category_name,
        c.slug AS category_slug,
        c.icon AS category_icon,
        c.description AS category_description,
        c.is_active AS category_is_active,
        u.id AS author_id,
        u.full_name AS author_name,
        u.username AS author_username
      FROM guides g
      JOIN categories c ON c.id = g.category_id
      JOIN users u ON u.id = g.author_id
      WHERE ${isUuid ? 'g.id = $1' : 'g.key_code = $1'};
    `;

    const guideResult = await db.query(guideQuery, [id]);

    if (guideResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'GUIDE_NOT_FOUND',
          message: 'Panduan tidak ditemukan.',
        },
      });
    }

    const row = guideResult.rows[0];

    // Query steps with deterministic ordering (step_number ASC)
    const stepsQuery = `
      SELECT 
        id,
        step_number,
        title,
        instruction,
        created_at
      FROM guide_steps
      WHERE guide_id = $1
      ORDER BY step_number ASC;
    `;

    const stepsResult = await db.query(stepsQuery, [row.id]);

    const guide = {
      id: row.id,
      key_code: row.key_code,
      title: row.title,
      location_scope: row.location_scope,
      image_url: row.image_url,
      estimated_time: row.estimated_time,
      user_description: row.user_description,
      symptoms: typeof row.symptoms === 'string' ? JSON.parse(row.symptoms) : row.symptoms,
      possible_causes: row.possible_causes,
      security_note: row.security_note,
      prompt_shortcut: row.prompt_shortcut,
      status: row.status,
      keywords: row.keywords,
      published_at: row.published_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      category: {
        id: row.category_id,
        name: row.category_name,
        slug: row.category_slug,
        icon: row.category_icon,
        description: row.category_description,
        is_active: row.category_is_active,
      },
      author: {
        id: row.author_id,
        full_name: row.author_name,
        username: row.author_username,
      },
      steps: stepsResult.rows,
    };

    return res.status(200).json({
      success: true,
      data: guide,
    });
  } catch (err) {
    console.error('[Admin Guides Error - GET /:id]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat mengambil data panduan.',
      },
    });
  }
});

/**
 * POST /api/v1/admin/guides
 * Protected: ADMIN, IT_MANAGER
 * Creates a new guide with optional inline steps transactionally
 */
router.post('/', requireAuth, requireRoles('ADMIN', 'IT_MANAGER'), async (req, res) => {
  const actor = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    const {
      title,
      category_id,
      location_scope,
      image_url,
      estimated_time,
      user_description,
      symptoms,
      possible_causes,
      security_note,
      prompt_shortcut,
      keywords,
      key_code,
      status,
      steps,
    } = req.body;

    // Validate required fields
    if (!title || !category_id || !location_scope || !image_url || !security_note) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Field title, category_id, location_scope, image_url, dan security_note wajib diisi.',
        },
      });
    }

    // Validate category_id format
    if (!UUID_REGEX.test(category_id)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CATEGORY_ID',
          message: 'Format category_id tidak valid.',
        },
      });
    }

    // Check category existence
    const catCheck = await db.query('SELECT id, name FROM categories WHERE id = $1', [category_id]);
    if (catCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CATEGORY',
          message: 'Kategori yang dipilih tidak ditemukan dalam sistem.',
        },
      });
    }

    // Validate status
    const guideStatus = status ? String(status).trim().toUpperCase() : 'DRAFT';
    if (!ALLOWED_STATUSES.includes(guideStatus)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: `Status tidak valid. Pilihan status: ${ALLOWED_STATUSES.join(', ')}.`,
        },
      });
    }

    // Determine & validate key_code
    const trimmedTitle = String(title).trim();
    let finalKeyCode = key_code ? String(key_code).trim().toLowerCase() : slugify(trimmedTitle);

    if (!finalKeyCode || finalKeyCode.length < 2) {
      finalKeyCode = `guide-${Date.now().toString(36)}`;
    }
    if (finalKeyCode.length > 50) {
      finalKeyCode = finalKeyCode.slice(0, 50).replace(/-+$/, '');
    }

    if (!KEY_CODE_REGEX.test(finalKeyCode)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_KEY_CODE',
          message: 'key_code hanya boleh terdiri dari 2-50 karakter alphanumeric, dash (-), atau underscore (_).',
        },
      });
    }

    // Check duplicate key_code
    const duplicateKeyCheck = await db.query(
      'SELECT id, title FROM guides WHERE LOWER(key_code) = LOWER($1)',
      [finalKeyCode]
    );

    if (duplicateKeyCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_KEY_CODE',
          message: `Key code "${finalKeyCode}" sudah digunakan oleh panduan lain. Gunakan key code berbeda.`,
        },
      });
    }

    // Validate steps if provided
    if (steps !== undefined && steps !== null) {
      if (!Array.isArray(steps)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Field steps harus berupa array.',
          },
        });
      }

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step || typeof step !== 'object' || !step.title || !step.instruction) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Langkah ke-${i + 1} tidak valid. Setiap langkah harus memiliki title dan instruction.`,
            },
          });
        }
      }
    }

    // Execute guide & steps creation in a transaction
    const client = await db.pool.connect();
    let createdGuide = null;
    const insertedSteps = [];

    try {
      await client.query('BEGIN');

      const insertGuideQuery = `
        INSERT INTO guides (
          category_id,
          author_id,
          key_code,
          title,
          location_scope,
          image_url,
          estimated_time,
          user_description,
          symptoms,
          possible_causes,
          security_note,
          prompt_shortcut,
          status,
          keywords,
          published_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          CASE WHEN $13 = 'PUBLISHED'::guide_status THEN CURRENT_TIMESTAMP ELSE NULL END
        )
        RETURNING *;
      `;

      const symptomsJson = JSON.stringify(Array.isArray(symptoms) ? symptoms : []);
      const guideRes = await client.query(insertGuideQuery, [
        category_id,
        actor.id,
        finalKeyCode,
        trimmedTitle,
        String(location_scope).trim(),
        String(image_url).trim(),
        estimated_time ? String(estimated_time).trim() : '2 - 4 Menit',
        user_description ? String(user_description).trim() : null,
        symptomsJson,
        possible_causes ? String(possible_causes).trim() : null,
        String(security_note).trim(),
        prompt_shortcut ? String(prompt_shortcut).trim() : null,
        guideStatus,
        keywords ? String(keywords).trim() : null,
      ]);

      createdGuide = guideRes.rows[0];

      // Insert steps if provided
      if (Array.isArray(steps) && steps.length > 0) {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const stepNumber = i + 1;
          const stepRes = await client.query(`
            INSERT INTO guide_steps (guide_id, step_number, title, instruction)
            VALUES ($1, $2, $3, $4)
            RETURNING id, step_number, title, instruction, created_at;
          `, [createdGuide.id, stepNumber, String(step.title).trim(), String(step.instruction).trim()]);
          insertedSteps.push(stepRes.rows[0]);
        }
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Record audit log
    await recordAuditLog({
      userId: actor.id,
      action: 'GUIDE_CREATED',
      entityName: 'guide',
      entityId: createdGuide.id,
      changes: {
        title: createdGuide.title,
        key_code: createdGuide.key_code,
        status: createdGuide.status,
        category_id: createdGuide.category_id,
        step_count: insertedSteps.length,
      },
      ipAddress,
      userAgent,
    });

    return res.status(201).json({
      success: true,
      data: {
        ...createdGuide,
        symptoms: typeof createdGuide.symptoms === 'string' ? JSON.parse(createdGuide.symptoms) : createdGuide.symptoms,
        steps: insertedSteps,
      },
      message: 'Panduan troubleshooting berhasil dibuat.',
    });
  } catch (err) {
    console.error('[Admin Guides Error - POST /]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat membuat panduan.',
      },
    });
  }
});

/**
 * PATCH /api/v1/admin/guides/:id
 * Protected: ADMIN, IT_MANAGER
 * Updates guide fields (category_id, title, key_code, location_scope, image_url, etc.)
 */
router.patch('/:id', requireAuth, requireRoles('ADMIN', 'IT_MANAGER'), async (req, res) => {
  const actor = req.user;
  const { id } = req.params;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Format ID panduan tidak valid.',
        },
      });
    }

    // Check guide exists
    const existingRes = await db.query('SELECT * FROM guides WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'GUIDE_NOT_FOUND',
          message: 'Panduan tidak ditemukan.',
        },
      });
    }

    const current = existingRes.rows[0];
    const {
      title,
      category_id,
      key_code,
      location_scope,
      image_url,
      estimated_time,
      user_description,
      symptoms,
      possible_causes,
      security_note,
      prompt_shortcut,
      keywords,
    } = req.body;

    const updates = [];
    const values = [];
    const changes = {};

    if (title !== undefined) {
      const trimmedTitle = String(title).trim();
      if (trimmedTitle.length < 2 || trimmedTitle.length > 200) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Judul panduan (title) harus berukuran 2-200 karakter.',
          },
        });
      }
      values.push(trimmedTitle);
      updates.push(`title = $${values.length}`);
      changes.title = { from: current.title, to: trimmedTitle };
    }

    if (category_id !== undefined) {
      if (!UUID_REGEX.test(category_id)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_CATEGORY_ID',
            message: 'Format category_id tidak valid.',
          },
        });
      }
      const catCheck = await db.query('SELECT id FROM categories WHERE id = $1', [category_id]);
      if (catCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_CATEGORY',
            message: 'Kategori tidak ditemukan.',
          },
        });
      }
      values.push(category_id);
      updates.push(`category_id = $${values.length}`);
      changes.category_id = { from: current.category_id, to: category_id };
    }

    if (key_code !== undefined) {
      const trimmedKeyCode = String(key_code).trim().toLowerCase();
      if (!KEY_CODE_REGEX.test(trimmedKeyCode)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_KEY_CODE',
            message: 'key_code hanya boleh berupa alphanumeric, strip (-), atau underscore (_), panjang 2-50 karakter.',
          },
        });
      }

      // Check uniqueness against other guides
      const dupCheck = await db.query(
        'SELECT id FROM guides WHERE LOWER(key_code) = LOWER($1) AND id != $2',
        [trimmedKeyCode, id]
      );

      if (dupCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'DUPLICATE_KEY_CODE',
            message: `Key code "${trimmedKeyCode}" sudah digunakan oleh panduan lain.`,
          },
        });
      }

      values.push(trimmedKeyCode);
      updates.push(`key_code = $${values.length}`);
      changes.key_code = { from: current.key_code, to: trimmedKeyCode };
    }

    if (location_scope !== undefined) {
      const trimmedLoc = String(location_scope).trim();
      values.push(trimmedLoc);
      updates.push(`location_scope = $${values.length}`);
      changes.location_scope = { from: current.location_scope, to: trimmedLoc };
    }

    if (image_url !== undefined) {
      const trimmedImg = String(image_url).trim();
      values.push(trimmedImg);
      updates.push(`image_url = $${values.length}`);
      changes.image_url = { from: current.image_url, to: trimmedImg };
    }

    if (estimated_time !== undefined) {
      const trimmedTime = String(estimated_time).trim();
      values.push(trimmedTime);
      updates.push(`estimated_time = $${values.length}`);
      changes.estimated_time = { from: current.estimated_time, to: trimmedTime };
    }

    if (user_description !== undefined) {
      const descVal = user_description ? String(user_description).trim() : null;
      values.push(descVal);
      updates.push(`user_description = $${values.length}`);
      changes.user_description = { from: current.user_description, to: descVal };
    }

    if (symptoms !== undefined) {
      const symptomsJson = JSON.stringify(Array.isArray(symptoms) ? symptoms : []);
      values.push(symptomsJson);
      updates.push(`symptoms = $${values.length}`);
      changes.symptoms = { updated: true };
    }

    if (possible_causes !== undefined) {
      const causesVal = possible_causes ? String(possible_causes).trim() : null;
      values.push(causesVal);
      updates.push(`possible_causes = $${values.length}`);
      changes.possible_causes = { from: current.possible_causes, to: causesVal };
    }

    if (security_note !== undefined) {
      const secVal = String(security_note).trim();
      values.push(secVal);
      updates.push(`security_note = $${values.length}`);
      changes.security_note = { from: current.security_note, to: secVal };
    }

    if (prompt_shortcut !== undefined) {
      const promptVal = prompt_shortcut ? String(prompt_shortcut).trim() : null;
      values.push(promptVal);
      updates.push(`prompt_shortcut = $${values.length}`);
      changes.prompt_shortcut = { from: current.prompt_shortcut, to: promptVal };
    }

    if (keywords !== undefined) {
      const kwVal = keywords ? String(keywords).trim() : null;
      values.push(kwVal);
      updates.push(`keywords = $${values.length}`);
      changes.keywords = { from: current.keywords, to: kwVal };
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_CHANGES_PROVIDED',
          message: 'Tidak ada data pembaruan yang diberikan.',
        },
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const updateQuery = `
      UPDATE guides
      SET ${updates.join(', ')}
      WHERE id = $${values.length}
      RETURNING *;
    `;

    const updateRes = await db.query(updateQuery, values);
    const updatedGuide = updateRes.rows[0];

    // Record audit log
    await recordAuditLog({
      userId: actor.id,
      action: 'GUIDE_UPDATED',
      entityName: 'guide',
      entityId: updatedGuide.id,
      changes,
      ipAddress,
      userAgent,
    });

    return res.status(200).json({
      success: true,
      data: {
        ...updatedGuide,
        symptoms: typeof updatedGuide.symptoms === 'string' ? JSON.parse(updatedGuide.symptoms) : updatedGuide.symptoms,
      },
      message: 'Data panduan berhasil diperbarui.',
    });
  } catch (err) {
    console.error('[Admin Guides Error - PATCH /:id]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat memperbarui panduan.',
      },
    });
  }
});

/**
 * PATCH /api/v1/admin/guides/:id/status
 * Protected: ADMIN, IT_MANAGER
 * Enforces deterministic lifecycle: DRAFT -> PUBLISHED -> ARCHIVED
 */
router.patch('/:id/status', requireAuth, requireRoles('ADMIN', 'IT_MANAGER'), async (req, res) => {
  const actor = req.user;
  const { id } = req.params;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Format ID panduan tidak valid.',
        },
      });
    }

    const { status } = req.body;
    if (!status || typeof status !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Field status wajib diisi.',
        },
      });
    }

    const targetStatus = status.trim().toUpperCase();
    if (!ALLOWED_STATUSES.includes(targetStatus)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: `Status tidak valid. Pilihan status: ${ALLOWED_STATUSES.join(', ')}.`,
        },
      });
    }

    const guideRes = await db.query('SELECT id, title, status, published_at FROM guides WHERE id = $1', [id]);
    if (guideRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'GUIDE_NOT_FOUND',
          message: 'Panduan tidak ditemukan.',
        },
      });
    }

    const guide = guideRes.rows[0];
    const currentStatus = guide.status;

    if (currentStatus === targetStatus) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_STATUS_CHANGE',
          message: `Status panduan sudah dalam kondisi ${targetStatus}.`,
        },
      });
    }

    // Transition Validation Matrix:
    // DRAFT -> PUBLISHED (allowed)
    // DRAFT -> ARCHIVED (allowed)
    // PUBLISHED -> ARCHIVED (allowed)
    // All other transitions (ARCHIVED -> any, PUBLISHED -> DRAFT) rejected
    const isAllowedTransition =
      (currentStatus === 'DRAFT' && targetStatus === 'PUBLISHED') ||
      (currentStatus === 'DRAFT' && targetStatus === 'ARCHIVED') ||
      (currentStatus === 'PUBLISHED' && targetStatus === 'ARCHIVED');

    if (!isAllowedTransition) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `Transisi status panduan dari ${currentStatus} ke ${targetStatus} tidak diizinkan.`,
        },
      });
    }

    let updateQuery;
    let queryParams;

    if (targetStatus === 'PUBLISHED') {
      updateQuery = `
        UPDATE guides
        SET status = 'PUBLISHED',
            published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, title, status, published_at, updated_at;
      `;
      queryParams = [id];
    } else {
      // ARCHIVED
      updateQuery = `
        UPDATE guides
        SET status = 'ARCHIVED',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, title, status, published_at, updated_at;
      `;
      queryParams = [id];
    }

    const updateRes = await db.query(updateQuery, queryParams);
    const updated = updateRes.rows[0];

    // Record audit log
    await recordAuditLog({
      userId: actor.id,
      action: 'GUIDE_STATUS_CHANGED',
      entityName: 'guide',
      entityId: updated.id,
      changes: {
        title: updated.title,
        previous_status: currentStatus,
        new_status: targetStatus,
      },
      ipAddress,
      userAgent,
    });

    return res.status(200).json({
      success: true,
      data: updated,
      message: `Status panduan berhasil diubah menjadi ${targetStatus}.`,
    });
  } catch (err) {
    console.error('[Admin Guides Error - PATCH /:id/status]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat mengubah status panduan.',
      },
    });
  }
});

/**
 * PUT /api/v1/admin/guides/:id/steps
 * Protected: ADMIN, IT_MANAGER
 * Replaces and normalizes guide steps sequentially (1, 2, 3...) in an atomic transaction
 */
router.put('/:id/steps', requireAuth, requireRoles('ADMIN', 'IT_MANAGER'), async (req, res) => {
  const actor = req.user;
  const { id } = req.params;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Format ID panduan tidak valid.',
        },
      });
    }

    const stepsArray = Array.isArray(req.body) ? req.body : req.body.steps;

    if (!Array.isArray(stepsArray) || stepsArray.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Langkah panduan (steps) harus berupa array yang berisi minimal satu langkah.',
        },
      });
    }

    // Validate each step
    for (let i = 0; i < stepsArray.length; i++) {
      const step = stepsArray[i];
      if (!step || typeof step !== 'object' || !step.title || !step.instruction) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Langkah ke-${i + 1} tidak valid. Setiap langkah harus memiliki title dan instruction yang tidak kosong.`,
          },
        });
      }
    }

    // Check guide exists
    const guideCheck = await db.query('SELECT id, title FROM guides WHERE id = $1', [id]);
    if (guideCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'GUIDE_NOT_FOUND',
          message: 'Panduan tidak ditemukan.',
        },
      });
    }

    const client = await db.pool.connect();
    const insertedSteps = [];

    try {
      await client.query('BEGIN');

      // Delete existing steps
      await client.query('DELETE FROM guide_steps WHERE guide_id = $1', [id]);

      // Insert new steps with sequential step_number
      for (let i = 0; i < stepsArray.length; i++) {
        const step = stepsArray[i];
        const stepNumber = i + 1;
        const insertRes = await client.query(`
          INSERT INTO guide_steps (guide_id, step_number, title, instruction)
          VALUES ($1, $2, $3, $4)
          RETURNING id, step_number, title, instruction, created_at;
        `, [id, stepNumber, String(step.title).trim(), String(step.instruction).trim()]);
        insertedSteps.push(insertRes.rows[0]);
      }

      // Touch updated_at on guide
      await client.query('UPDATE guides SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Record audit log
    await recordAuditLog({
      userId: actor.id,
      action: 'GUIDE_STEPS_UPDATED',
      entityName: 'guide',
      entityId: id,
      changes: {
        step_count: insertedSteps.length,
        steps: insertedSteps.map((s) => ({ step_number: s.step_number, title: s.title })),
      },
      ipAddress,
      userAgent,
    });

    return res.status(200).json({
      success: true,
      data: insertedSteps,
      message: `Berhasil memperbarui ${insertedSteps.length} langkah panduan.`,
    });
  } catch (err) {
    console.error('[Admin Guides Error - PUT /:id/steps]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat memperbarui langkah panduan.',
      },
    });
  }
});

module.exports = router;
