/*
 * Seed 50 categories, 5000 products, 50000 reviews.
 * Also generates ~20 deliberately-large JPG images (2000x2000, quality 100)
 * reused across products via image_path. That is the "unoptimized images"
 * anti-pattern for the frontend.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Client } = require('pg');

const NUM_CATEGORIES = 50;
const NUM_PRODUCTS = 5000;
const REVIEWS_PER_PRODUCT_AVG = 10;
const NUM_IMAGES = 20;
const IMAGE_DIR = path.join(__dirname, '..', 'src', 'images');

const CATEGORY_WORDS = [
  'Electronics', 'Books', 'Clothing', 'Home', 'Kitchen', 'Toys', 'Sports',
  'Beauty', 'Garden', 'Automotive', 'Tools', 'Music', 'Office', 'Pet',
  'Grocery', 'Shoes', 'Jewelry', 'Watches', 'Health', 'Baby',
  'Outdoor', 'Fitness', 'Camping', 'Travel', 'Gaming',
  'Photography', 'Art', 'Crafts', 'Stationery', 'Lighting',
  'Bedding', 'Bath', 'Decor', 'Furniture', 'Appliances',
  'Phones', 'Computers', 'Tablets', 'Audio', 'Cameras',
  'Networking', 'Storage', 'Accessories', 'Smart Home', 'Wearables',
  'Software', 'Media', 'Groceries', 'Snacks', 'Beverages',
];

const ADJECTIVES = ['Premium', 'Classic', 'Modern', 'Vintage', 'Eco', 'Pro', 'Lite', 'Ultra', 'Smart', 'Basic'];
const NOUNS = ['Widget', 'Gadget', 'Kit', 'Set', 'Bundle', 'Edition', 'Collection', 'Pack', 'System', 'Device'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

async function ensureLargeImages() {
  if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const existing = fs.readdirSync(IMAGE_DIR).filter(f => f.startsWith('product-') && f.endsWith('.jpg'));
  if (existing.length >= NUM_IMAGES) {
    console.log(`[seed] images already present (${existing.length})`);
    return;
  }
  console.log(`[seed] generating ${NUM_IMAGES} large JPGs (2000x2000 @ q=100)`);
  for (let i = 0; i < NUM_IMAGES; i++) {
    const r = randInt(30, 220), g = randInt(30, 220), b = randInt(30, 220);
    // SVG with noise-ish rectangles so compression can't squash it to nothing.
    const shapes = Array.from({ length: 200 }, () => {
      const x = randInt(0, 2000), y = randInt(0, 2000);
      const w = randInt(20, 300), h = randInt(20, 300);
      const rr = randInt(0, 255), gg = randInt(0, 255), bb = randInt(0, 255);
      const op = (Math.random() * 0.6 + 0.3).toFixed(2);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgb(${rr},${gg},${bb})" opacity="${op}"/>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><rect width="2000" height="2000" fill="rgb(${r},${g},${b})"/>${shapes}</svg>`;
    const out = path.join(IMAGE_DIR, `product-${i + 1}.jpg`);
    await sharp(Buffer.from(svg))
      .jpeg({ quality: 100, mozjpeg: false })
      .toFile(out);
    process.stdout.write('.');
  }
  process.stdout.write('\n');
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://shop:shop@localhost:5432/shop' });
  await db.connect();

  console.log('[seed] truncating tables');
  await db.query('TRUNCATE reviews, products, categories RESTART IDENTITY CASCADE');

  await ensureLargeImages();

  console.log(`[seed] inserting ${NUM_CATEGORIES} categories`);
  const catIds = [];
  for (let i = 0; i < NUM_CATEGORIES; i++) {
    const name = CATEGORY_WORDS[i % CATEGORY_WORDS.length] + (i >= CATEGORY_WORDS.length ? ` ${i}` : '');
    const { rows } = await db.query(
      'INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id',
      [name, slug(name)]
    );
    catIds.push(rows[0].id);
  }

  console.log(`[seed] inserting ${NUM_PRODUCTS} products`);
  const productIds = [];
  const batchSize = 500;
  for (let start = 0; start < NUM_PRODUCTS; start += batchSize) {
    const values = [];
    const placeholders = [];
    let p = 1;
    for (let i = 0; i < batchSize && start + i < NUM_PRODUCTS; i++) {
      const idx = start + i;
      const name = `${pick(ADJECTIVES)} ${pick(NOUNS)} #${idx + 1}`;
      const desc = `High quality ${pick(ADJECTIVES).toLowerCase()} item suitable for everyday use. Item number ${idx + 1}.`;
      const price = (Math.random() * 990 + 10).toFixed(2);
      const stock = randInt(0, 500);
      const categoryId = catIds[randInt(0, catIds.length - 1)];
      const imagePath = `product-${(idx % NUM_IMAGES) + 1}.jpg`;
      const featured = Math.random() < 0.05;
      const createdAt = new Date(Date.now() - randInt(0, 365 * 24 * 3600 * 1000));
      placeholders.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
      values.push(name, desc, price, stock, categoryId, imagePath, featured, createdAt);
    }
    const { rows } = await db.query(
      `INSERT INTO products (name, description, price, stock, category_id, image_path, featured, created_at)
       VALUES ${placeholders.join(', ')} RETURNING id`,
      values
    );
    for (const r of rows) productIds.push(r.id);
    process.stdout.write(`  products ${Math.min(start + batchSize, NUM_PRODUCTS)}/${NUM_PRODUCTS}\r`);
  }
  process.stdout.write('\n');

  console.log(`[seed] inserting ~${NUM_PRODUCTS * REVIEWS_PER_PRODUCT_AVG} reviews`);
  const reviewBodies = [
    'Works great. Would buy again.',
    'Not what I expected but decent.',
    'Arrived quickly, well packaged.',
    'Quality is average for the price.',
    'Absolutely love it, five stars.',
    'Broke after a week, disappointed.',
    'Exactly as described.',
    'Gift for a friend, they loved it.',
  ];
  for (let p = 0; p < productIds.length; p += 200) {
    const batch = productIds.slice(p, p + 200);
    const values = [];
    const placeholders = [];
    let ph = 1;
    for (const pid of batch) {
      const n = randInt(0, REVIEWS_PER_PRODUCT_AVG * 2);
      for (let i = 0; i < n; i++) {
        placeholders.push(`($${ph++}, $${ph++}, $${ph++})`);
        values.push(pid, randInt(1, 5), pick(reviewBodies));
      }
    }
    if (placeholders.length) {
      await db.query(
        `INSERT INTO reviews (product_id, rating, body) VALUES ${placeholders.join(', ')}`,
        values
      );
    }
    process.stdout.write(`  reviews through product ${Math.min(p + 200, productIds.length)}/${productIds.length}\r`);
  }
  process.stdout.write('\n');

  const { rows: [{ count: rc }] } = await db.query('SELECT COUNT(*)::int AS count FROM reviews');
  console.log(`[seed] done. categories=${catIds.length} products=${productIds.length} reviews=${rc}`);
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
