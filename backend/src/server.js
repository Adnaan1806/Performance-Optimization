const express = require('express');
const compression = require('compression');
const path = require('path');
const signing = require('./middleware/signing');

const homeRouter = require('./routes/home');
const productsRouter = require('./routes/products');
const searchRouter = require('./routes/search');

const app = express();

app.use(compression());
app.use(express.json());

// Permissive CORS for dev.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(signing);

// Cache-Control middleware — applied per-router with appropriate TTLs.
function cacheFor(seconds) {
  return (req, res, next) => {
    if (req.method === 'GET') {
      res.set('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${seconds * 5}`);
    }
    next();
  };
}

// Images are static and never change — cache for 1 year.
app.use('/images', express.static(path.join(__dirname, 'images'), {
  maxAge: '1y',
  immutable: true,
}));

app.use('/home',     cacheFor(60),  homeRouter);      // homepage sections: 60s fresh
app.use('/products', cacheFor(300), productsRouter);   // product data: 5min fresh
app.use('/search',   cacheFor(30),  searchRouter);     // search results: 30s fresh

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`backend listening on :${port}`));
