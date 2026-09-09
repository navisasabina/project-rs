const express = require('express');
const router = express.Router();
const db = require('../config/database');

/**
 * GET /api/v1/categories
 * Mengembalikan daftar kategori yang memiliki panduan PUBLISHED.
 * Kategori dengan hanya DRAFT atau ARCHIVED tidak ditampilkan di Public API.
 */
router.get('/', async (req, res) => {
  try {
    const queryText = `
      SELECT 
        c.id,
        c.name,
        c.slug,
        c.icon,
        c.description,
        c.display_order,
        COUNT(g.id)::int AS guide_count
      FROM categories c
      JOIN guides g ON g.category_id = c.id
      WHERE c.is_active = TRUE
        AND g.status = 'PUBLISHED'
      GROUP BY c.id, c.name, c.slug, c.icon, c.description, c.display_order
      ORDER BY c.display_order ASC, c.name ASC;
    `;

    const result = await db.query(queryText);

    return res.status(200).json({
      success: true,
      data: result.rows,
      meta: {
        count: result.rows.length,
      },
    });
  } catch (err) {
    console.error('[Public API Error - GET /categories]:', err);
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
