const express = require('express');
const { getClient } = require('../db');
const { loadConfig } = require('../config');
const { withCache } = require('../cache');

const router = express.Router();

// Map a flat JOIN row into the nested shape the frontend expects.
function shape(row) {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    category_id: row.category_id,
    image_path: row.image_path,
    category: row.cat_id ? { id: row.cat_id, name: row.cat_name, slug: row.cat_slug } : null,
    avg_rating: row.avg_rating,
    review_count: row.review_count,
  };
}

// GET /home — three sections, each resolved in a single JOIN query (no N+1).
// Full response cached in Redis for 60s.
router.get('/', async (req, res, next) => {
  try {
    const config = loadConfig();

    const data = await withCache('home', 60, async () => {
      const db = getClient();

      const { rows: featured } = await db.query(
        `SELECT p.id, p.name, p.price, p.category_id, p.image_path,
                c.id AS cat_id, c.name AS cat_name, c.slug AS cat_slug,
                COALESCE(AVG(r.rating), 0)::float AS avg_rating,
                COUNT(r.id)::int AS review_count
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN reviews r ON r.product_id = p.id
         WHERE p.featured = TRUE
         GROUP BY p.id, c.id, c.name, c.slug
         ORDER BY p.created_at DESC
         LIMIT $1`,
        [config.featuredLimit]
      );

      const { rows: newArrivals } = await db.query(
        `SELECT p.id, p.name, p.price, p.category_id, p.image_path,
                c.id AS cat_id, c.name AS cat_name, c.slug AS cat_slug,
                COALESCE(AVG(r.rating), 0)::float AS avg_rating,
                COUNT(r.id)::int AS review_count
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN reviews r ON r.product_id = p.id
         GROUP BY p.id, c.id, c.name, c.slug
         ORDER BY p.created_at DESC
         LIMIT $1`,
        [config.newArrivalsLimit]
      );

      const { rows: topRated } = await db.query(
        `SELECT p.id, p.name, p.price, p.category_id, p.image_path,
                c.id AS cat_id, c.name AS cat_name, c.slug AS cat_slug,
                AVG(r.rating)::float AS avg_rating,
                COUNT(r.id)::int AS review_count
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN reviews r ON r.product_id = p.id
         GROUP BY p.id, c.id, c.name, c.slug
         HAVING COUNT(r.id) >= 3
         ORDER BY avg_rating DESC, review_count DESC
         LIMIT $1`,
        [config.topRatedLimit]
      );

      return {
        site: config.siteName,
        featured: featured.map(shape),
        newArrivals: newArrivals.map(shape),
        topRated: topRated.map(shape),
      };
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
