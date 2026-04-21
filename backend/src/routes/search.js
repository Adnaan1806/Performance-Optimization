const express = require('express');
const { getClient } = require('../db');

const router = express.Router();

// GET /search?q=... — single JOIN query, no N+1 category lookup per result.
router.get('/', async (req, res, next) => {
  try {
    const db = await getClient();
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json({ query: q, count: 0, results: [] });

    const { rows } = await db.query(
      `SELECT p.id, p.name, p.description, p.price, p.category_id, p.image_path,
              c.id AS cat_id, c.name AS cat_name, c.slug AS cat_slug
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.name ILIKE $1 OR p.description ILIKE $1
       ORDER BY p.created_at DESC`,
      [`%${q}%`]
    );

    const results = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: row.price,
      category_id: row.category_id,
      image_path: row.image_path,
      category: row.cat_id ? { id: row.cat_id, name: row.cat_name, slug: row.cat_slug } : null,
    }));

    res.json({ query: q, count: results.length, results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
