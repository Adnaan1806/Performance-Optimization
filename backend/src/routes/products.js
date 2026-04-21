const express = require('express');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { getClient } = require('../db');
const { loadConfig } = require('../config');

const router = express.Router();

// In-process thumbnail cache: image_path → base64 data URI.
// Only 20 unique source images exist — cache fills fast and stays small.
const thumbnailCache = new Map();

async function getThumbnail(imagePath) {
  if (thumbnailCache.has(imagePath)) return thumbnailCache.get(imagePath);
  const imageAbs = path.join(__dirname, '..', 'images', imagePath);
  if (!fs.existsSync(imageAbs)) return null;
  const buf = await sharp(imageAbs).resize(400, 400, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
  const dataUri = `data:image/jpeg;base64,${buf.toString('base64')}`;
  thumbnailCache.set(imagePath, dataUri);
  return dataUri;
}

// GET /products?page=1&limit=20 — paginated product list.
router.get('/', async (req, res, next) => {
  try {
    const db = await getClient();
    const config = loadConfig();

    const limit  = Math.min(parseInt(req.query.limit, 10)  || 20, 100);
    const page   = Math.max(parseInt(req.query.page,  10)  || 1,  1);
    const offset = (page - 1) * limit;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      db.query(
        `SELECT p.id, p.name, p.description, p.price, p.stock, p.category_id,
                p.image_path, p.featured, p.created_at,
                c.id AS cat_id, c.name AS cat_name, c.slug AS cat_slug,
                COALESCE(AVG(r.rating), 0)::float AS avg_rating,
                COUNT(r.id)::int AS review_count
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN reviews r ON r.product_id = p.id
         GROUP BY p.id, c.id, c.name, c.slug
         ORDER BY p.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      db.query('SELECT COUNT(*)::int AS total FROM products'),
    ]);

    const total = countRows[0].total;

    const products = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: row.price,
      stock: row.stock,
      category_id: row.category_id,
      image_path: row.image_path,
      featured: row.featured,
      created_at: row.created_at,
      category: row.cat_id ? { id: row.cat_id, name: row.cat_name, slug: row.cat_slug } : null,
      avg_rating: row.avg_rating,
      review_count: row.review_count,
    }));

    res.json({
      site: config.siteName,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      count: products.length,
      products,
    });
  } catch (err) {
    next(err);
  }
});

// GET /products/:id — product detail. Regenerates a thumbnail synchronously on every request.
router.get('/:id', async (req, res, next) => {
  try {
    const db = await getClient();
    const id = parseInt(req.params.id, 10);

    const { rows } = await db.query(
      'SELECT id, name, description, price, stock, category_id, image_path, featured, created_at FROM products WHERE id = $1',
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    const product = rows[0];

    const { rows: catRows } = await db.query(
      'SELECT id, name, slug FROM categories WHERE id = $1',
      [product.category_id]
    );

    const { rows: reviewRows } = await db.query(
      'SELECT id, rating, body, created_at FROM reviews WHERE product_id = $1 ORDER BY created_at DESC',
      [product.id]
    );

    const thumbnailBase64 = await getThumbnail(product.image_path);

    res.json({
      ...product,
      category: catRows[0] || null,
      reviews: reviewRows,
      thumbnail: thumbnailBase64,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /products/:id — admin update (price / stock / featured).
// No cache invalidation plumbing — intentional. Learners add this when they wire Redis.
router.patch('/:id', async (req, res, next) => {
  try {
    const db = await getClient();
    const id = parseInt(req.params.id, 10);
    const fields = ['price', 'stock', 'featured'];
    const updates = [];
    const values = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${i++}`);
        values.push(req.body[f]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'no fields to update' });
    values.push(id);
    const { rows } = await db.query(
      `UPDATE products SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
