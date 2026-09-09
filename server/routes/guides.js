const express = require('express');
const router = express.Router();
const db = require('../config/database');

// UUID validation regex (v4 / general uuid)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Key code validation regex (lowercase alphanumeric with dashes/underscores)
const KEY_CODE_REGEX = /^[a-zA-Z0-9_-]{2,50}$/;

/**
 * GET /api/v1/guides
 * Mengembalikan daftar ringkas panduan berstatus PUBLISHED.
 * Mendukung filter opsional ?category=slug.
 * Tidak mengekspos DRAFT atau ARCHIVED ke publik.
 */
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;

    const queryParams = [];
    let queryText = `
      SELECT 
        g.id,
        g.key_code,
        g.title,
        g.location_scope,
        g.image_url,
        g.estimated_time,
        g.symptoms,
        g.security_note,
        g.prompt_shortcut,
        g.status,
        c.id AS category_id,
        c.name AS category_name,
        c.slug AS category_slug,
        c.icon AS category_icon
      FROM guides g
      JOIN categories c ON c.id = g.category_id
      WHERE g.status = 'PUBLISHED'
        AND c.is_active = TRUE
    `;

    if (category) {
      if (typeof category !== 'string' || !KEY_CODE_REGEX.test(category)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_QUERY_PARAMETER',
            message: 'Parameter category tidak valid.',
          },
        });
      }
      queryParams.push(category);
      queryText += ` AND c.slug = $${queryParams.length}`;
    }

    queryText += ` ORDER BY c.display_order ASC, g.title ASC;`;

    const result = await db.query(queryText, queryParams);

    // Format category object nested cleanly
    const guides = result.rows.map((row) => ({
      id: row.id,
      key_code: row.key_code,
      title: row.title,
      location_scope: row.location_scope,
      image_url: row.image_url,
      estimated_time: row.estimated_time,
      symptoms: typeof row.symptoms === 'string' ? JSON.parse(row.symptoms) : row.symptoms,
      security_note: row.security_note,
      prompt_shortcut: row.prompt_shortcut,
      status: row.status,
      category: {
        id: row.category_id,
        name: row.category_name,
        slug: row.category_slug,
        icon: row.category_icon,
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
    console.error('[Public API Error - GET /guides]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan internal pada server.',
      },
    });
  }
});

/**
 * GET /api/v1/guides/:id_or_key
 * Mengembalikan data lengkap panduan berstatus PUBLISHED beserta urutan guide_steps (1 -> 2 -> 3).
 * Menerima :id_or_key baik sebagai UUID maupun key_code (contoh: "printer", "lan", "cache").
 */
router.get('/:id_or_key', async (req, res) => {
  try {
    const { id_or_key } = req.params;

    // Validate identifier format
    const isUuid = UUID_REGEX.test(id_or_key);
    const isKeyCode = KEY_CODE_REGEX.test(id_or_key);

    if (!isUuid && !isKeyCode) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_IDENTIFIER',
          message: 'Format identifier panduan tidak valid.',
        },
      });
    }

    // Lookup guide with published status constraint
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
        c.id AS category_id,
        c.name AS category_name,
        c.slug AS category_slug,
        c.icon AS category_icon,
        c.description AS category_description
      FROM guides g
      JOIN categories c ON c.id = g.category_id
      WHERE g.status = 'PUBLISHED'
        AND ${isUuid ? 'g.id = $1' : 'g.key_code = $1'};
    `;

    const guideResult = await db.query(guideQuery, [id_or_key]);

    if (guideResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'GUIDE_NOT_FOUND',
          message: 'Panduan tidak ditemukan atau belum dipublikasikan.',
        },
      });
    }

    const row = guideResult.rows[0];

    // Query steps with deterministic ordering: ORDER BY step_number ASC
    const stepsQuery = `
      SELECT 
        id,
        step_number,
        title,
        instruction
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
      category: {
        id: row.category_id,
        name: row.category_name,
        slug: row.category_slug,
        icon: row.category_icon,
        description: row.category_description,
      },
      steps: stepsResult.rows,
    };

    return res.status(200).json({
      success: true,
      data: guide,
    });
  } catch (err) {
    console.error('[Public API Error - GET /guides/:id_or_key]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan internal pada server.',
      },
    });
  }
});

module.exports = router;
