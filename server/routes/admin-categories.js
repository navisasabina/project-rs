/**
 * Admin Categories Management Routes
 * 
 * Implements:
 * - GET    /api/v1/admin/categories         (List all categories including inactive ones with guide counts)
 * - POST   /api/v1/admin/categories         (Create new category with slug uniqueness and validation)
 * - PATCH  /api/v1/admin/categories/:id     (Update category fields)
 * - PATCH  /api/v1/admin/categories/:id/status (Activate / deactivate category)
 * 
 * Role & Security Boundaries:
 * - Requires authentication (requireAuth)
 * - ADMIN & IT_MANAGER: Full management (create, update, change status)
 * - IT_SUPPORT: Read-only access (GET only, mutations rejected with 403)
 * - Parameterized SQL queries & Audit logging
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { recordAuditLog } = require('../services/auth');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_REGEX = /^[a-z0-9_-]{2,100}$/;

/**
 * Helper to generate URL-safe deterministic slug
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
 * GET /api/v1/admin/categories
 * Protected: ADMIN, IT_MANAGER, IT_SUPPORT
 * Lists all categories (active and inactive) ordered by display_order ASC, name ASC
 */
router.get('/', requireAuth, requireRoles('ADMIN', 'IT_MANAGER', 'IT_SUPPORT'), async (req, res) => {
  try {
    const queryText = `
      SELECT 
        c.id,
        c.name,
        c.slug,
        c.icon,
        c.description,
        c.display_order,
        c.is_active,
        c.created_at,
        c.updated_at,
        COUNT(g.id)::int AS guide_count
      FROM categories c
      LEFT JOIN guides g ON g.category_id = c.id
      GROUP BY c.id, c.name, c.slug, c.icon, c.description, c.display_order, c.is_active, c.created_at, c.updated_at
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
    console.error('[Admin Categories Error - GET /]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat mengambil daftar kategori.',
      },
    });
  }
});

/**
 * POST /api/v1/admin/categories
 * Protected: ADMIN, IT_MANAGER
 * Body: { name, slug, icon, description, display_order, is_active }
 */
router.post('/', requireAuth, requireRoles('ADMIN', 'IT_MANAGER'), async (req, res) => {
  const actor = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    const { name, slug, icon, description, display_order, is_active } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Nama kategori wajib diisi dengan panjang antara 2 hingga 100 karakter.',
        },
      });
    }

    const trimmedName = name.trim();
    let finalSlug = slug ? String(slug).trim().toLowerCase() : slugify(trimmedName);

    if (!SLUG_REGEX.test(finalSlug)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SLUG',
          message: 'Slug kategori hanya boleh berupa huruf kecil, angka, tanda strip (-), atau underscore (_), panjang 2-100 karakter.',
        },
      });
    }

    // Check duplicate slug
    const duplicateCheck = await db.query(
      'SELECT id, name FROM categories WHERE LOWER(slug) = LOWER($1)',
      [finalSlug]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_SLUG',
          message: `Slug kategori "${finalSlug}" sudah terdaftar. Gunakan slug lain.`,
        },
      });
    }

    const finalIcon = (icon && typeof icon === 'string' && icon.trim().length > 0) ? icon.trim().slice(0, 50) : 'devices';
    const finalDescription = (description && typeof description === 'string') ? description.trim() : null;
    const finalDisplayOrder = Number.isInteger(display_order) ? display_order : 0;
    const finalIsActive = typeof is_active === 'boolean' ? is_active : true;

    const insertQuery = `
      INSERT INTO categories (name, slug, icon, description, display_order, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, slug, icon, description, display_order, is_active, created_at, updated_at;
    `;

    const result = await db.query(insertQuery, [
      trimmedName,
      finalSlug,
      finalIcon,
      finalDescription,
      finalDisplayOrder,
      finalIsActive,
    ]);

    const newCategory = result.rows[0];

    // Record audit log
    await recordAuditLog({
      userId: actor.id,
      action: 'CATEGORY_CREATED',
      entityName: 'category',
      entityId: newCategory.id,
      changes: {
        name: newCategory.name,
        slug: newCategory.slug,
        icon: newCategory.icon,
        display_order: newCategory.display_order,
        is_active: newCategory.is_active,
      },
      ipAddress,
      userAgent,
    });

    return res.status(201).json({
      success: true,
      data: newCategory,
      message: 'Kategori baru berhasil ditambahkan.',
    });
  } catch (err) {
    console.error('[Admin Categories Error - POST /]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat membuat kategori.',
      },
    });
  }
});

/**
 * PATCH /api/v1/admin/categories/:id
 * Protected: ADMIN, IT_MANAGER
 * Body: { name, slug, icon, description, display_order }
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
          message: 'Format ID kategori tidak valid.',
        },
      });
    }

    // Verify existing category
    const existingRes = await db.query(
      'SELECT id, name, slug, icon, description, display_order, is_active FROM categories WHERE id = $1',
      [id]
    );

    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CATEGORY_NOT_FOUND',
          message: 'Kategori tidak ditemukan.',
        },
      });
    }

    const current = existingRes.rows[0];
    const { name, slug, icon, description, display_order } = req.body;

    const updates = [];
    const values = [];
    const changes = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Nama kategori harus terdiri dari 2 hingga 100 karakter.',
          },
        });
      }
      values.push(name.trim());
      updates.push(`name = $${values.length}`);
      changes.name = { from: current.name, to: name.trim() };
    }

    if (slug !== undefined) {
      const trimmedSlug = String(slug).trim().toLowerCase();
      if (!SLUG_REGEX.test(trimmedSlug)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_SLUG',
            message: 'Slug kategori hanya boleh berupa huruf kecil, angka, tanda strip (-), atau underscore (_), panjang 2-100 karakter.',
          },
        });
      }

      // Check slug uniqueness across other categories
      const duplicateCheck = await db.query(
        'SELECT id FROM categories WHERE LOWER(slug) = LOWER($1) AND id != $2',
        [trimmedSlug, id]
      );

      if (duplicateCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'DUPLICATE_SLUG',
            message: `Slug kategori "${trimmedSlug}" sudah digunakan oleh kategori lain.`,
          },
        });
      }

      values.push(trimmedSlug);
      updates.push(`slug = $${values.length}`);
      changes.slug = { from: current.slug, to: trimmedSlug };
    }

    if (icon !== undefined) {
      if (typeof icon !== 'string' || icon.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Icon harus berupa teks valid.',
          },
        });
      }
      const trimmedIcon = icon.trim().slice(0, 50);
      values.push(trimmedIcon);
      updates.push(`icon = $${values.length}`);
      changes.icon = { from: current.icon, to: trimmedIcon };
    }

    if (description !== undefined) {
      const descVal = typeof description === 'string' ? description.trim() : null;
      values.push(descVal);
      updates.push(`description = $${values.length}`);
      changes.description = { from: current.description, to: descVal };
    }

    if (display_order !== undefined) {
      if (!Number.isInteger(display_order)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'display_order harus berupa bilangan bulat integer.',
          },
        });
      }
      values.push(display_order);
      updates.push(`display_order = $${values.length}`);
      changes.display_order = { from: current.display_order, to: display_order };
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_CHANGES_PROVIDED',
          message: 'Tidak ada field pembaruan yang diberikan.',
        },
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const updateQuery = `
      UPDATE categories
      SET ${updates.join(', ')}
      WHERE id = $${values.length}
      RETURNING id, name, slug, icon, description, display_order, is_active, created_at, updated_at;
    `;

    const updateRes = await db.query(updateQuery, values);
    const updatedCategory = updateRes.rows[0];

    // Record audit log
    await recordAuditLog({
      userId: actor.id,
      action: 'CATEGORY_UPDATED',
      entityName: 'category',
      entityId: updatedCategory.id,
      changes,
      ipAddress,
      userAgent,
    });

    return res.status(200).json({
      success: true,
      data: updatedCategory,
      message: 'Kategori berhasil diperbarui.',
    });
  } catch (err) {
    console.error('[Admin Categories Error - PATCH /:id]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat memperbarui kategori.',
      },
    });
  }
});

/**
 * PATCH /api/v1/admin/categories/:id/status
 * Protected: ADMIN, IT_MANAGER
 * Body: { is_active: boolean }
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
          message: 'Format ID kategori tidak valid.',
        },
      });
    }

    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Field is_active harus berupa boolean (true/false).',
        },
      });
    }

    const existingRes = await db.query(
      'SELECT id, name, slug, is_active FROM categories WHERE id = $1',
      [id]
    );

    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CATEGORY_NOT_FOUND',
          message: 'Kategori tidak ditemukan.',
        },
      });
    }

    const current = existingRes.rows[0];

    const updateRes = await db.query(`
      UPDATE categories
      SET is_active = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, name, slug, icon, description, display_order, is_active, updated_at;
    `, [is_active, id]);

    const updatedCategory = updateRes.rows[0];

    // Record audit log
    await recordAuditLog({
      userId: actor.id,
      action: 'CATEGORY_STATUS_CHANGED',
      entityName: 'category',
      entityId: updatedCategory.id,
      changes: {
        category_name: updatedCategory.name,
        previous_is_active: current.is_active,
        new_is_active: is_active,
      },
      ipAddress,
      userAgent,
    });

    return res.status(200).json({
      success: true,
      data: updatedCategory,
      message: `Status kategori berhasil diubah menjadi ${is_active ? 'aktif' : 'non-aktif'}.`,
    });
  } catch (err) {
    console.error('[Admin Categories Error - PATCH /:id/status]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan sistem saat mengubah status kategori.',
      },
    });
  }
});

module.exports = router;
