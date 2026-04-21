const express = require('express');
const { getClient } = require('../db');
const { loadConfig } = require('../config');

const router = express.Router();

// Helper that repeats the N+1 pattern for any slice of products.
async function enrich(db, products) {
  const out = [];
  for (const p of products) {
    const { rows: catRows } = await db.query(
      'SELECT id, name, slug FROM categories WHERE id = $1',
      [p.category_id]
    );
    const { rows: ratingRows } = await db.query(
      'SELECT COALESCE(AVG(rating), 0)::float AS avg_rating, COUNT(*)::int AS review_count FROM reviews WHERE product_id = $1',
      [p.id]
    );
    out.push({
      ...p,
      category: catRows[0] || null,
      avg_rating: ratingRows[0].avg_rating,
      review_count: ratingRows[0].review_count,
    });
  }
  return out;
}

// GET /home — three sections, each its own N+1.
router.get('/', async (req, res, next) => {
  try {
    const db = await getClient();
    const config = loadConfig();

    const { rows: featured } = await db.query(
      'SELECT id, name, price, category_id, image_path FROM products WHERE featured = TRUE ORDER BY created_at DESC LIMIT $1',
      [config.featuredLimit]
    );
    const { rows: newArrivals } = await db.query(
      'SELECT id, name, price, category_id, image_path FROM products ORDER BY created_at DESC LIMIT $1',
      [config.newArrivalsLimit]
    );
    // Top-rated: subquery over reviews (no index on reviews.product_id → seq scan).
    const { rows: topRated } = await db.query(
      `SELECT p.id, p.name, p.price, p.category_id, p.image_path
       FROM products p
       JOIN (
         SELECT product_id, AVG(rating) AS avg_rating, COUNT(*) AS n
         FROM reviews
         GROUP BY product_id
         HAVING COUNT(*) >= 3
       ) r ON r.product_id = p.id
       ORDER BY r.avg_rating DESC, r.n DESC
       LIMIT $1`,
      [config.topRatedLimit]
    );

    res.json({
      site: config.siteName,
      featured: await enrich(db, featured),
      newArrivals: await enrich(db, newArrivals),
      topRated: await enrich(db, topRated),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
