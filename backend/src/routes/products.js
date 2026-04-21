const express = require('express');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { getClient } = require('../db');
const { loadConfig } = require('../config');

const router = express.Router();

// GET /products — list all products
// Pulls all rows, then for EACH product runs two extra queries (category + avg rating).
router.get('/', async (req, res, next) => {
  try {
    const db = await getClient();
    const config = loadConfig();

    const { rows: products } = await db.query(
      'SELECT id, name, description, price, stock, category_id, image_path, featured, created_at FROM products ORDER BY created_at DESC'
    );

    const enriched = [];
    for (const p of products) {
      const { rows: catRows } = await db.query(
        'SELECT id, name, slug FROM categories WHERE id = $1',
        [p.category_id]
      );
      const { rows: ratingRows } = await db.query(
        'SELECT COALESCE(AVG(rating), 0)::float AS avg_rating, COUNT(*)::int AS review_count FROM reviews WHERE product_id = $1',
        [p.id]
      );
      enriched.push({
        ...p,
        category: catRows[0] || null,
        avg_rating: ratingRows[0].avg_rating,
        review_count: ratingRows[0].review_count,
      });
    }

    res.json({ site: config.siteName, count: enriched.length, products: enriched });
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

    // Regenerate a thumbnail on every single request. No cache, no CDN.
    const imageAbs = path.join(__dirname, '..', 'images', product.image_path);
    let thumbnailBase64 = null;
    if (fs.existsSync(imageAbs)) {
      const buf = await sharp(imageAbs).resize(400, 400, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
      thumbnailBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
    }

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
