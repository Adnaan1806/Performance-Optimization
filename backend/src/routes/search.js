const express = require('express');
const { getClient } = require('../db');

const router = express.Router();

// GET /search?q=... — ILIKE wildcard on an unindexed text column.
router.get('/', async (req, res, next) => {
  try {
    const db = await getClient();
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json({ query: q, count: 0, results: [] });

    const { rows: products } = await db.query(
      "SELECT id, name, description, price, category_id, image_path FROM products WHERE name ILIKE $1 OR description ILIKE $1 ORDER BY created_at DESC",
      [`%${q}%`]
    );

    // N+1 again — category lookup per match.
    const results = [];
    for (const p of products) {
      const { rows: catRows } = await db.query(
        'SELECT id, name, slug FROM categories WHERE id = $1',
        [p.category_id]
      );
      results.push({ ...p, category: catRows[0] || null });
    }

    res.json({ query: q, count: results.length, results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
