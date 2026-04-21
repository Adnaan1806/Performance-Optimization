const express = require('express');
const path = require('path');
const signing = require('./middleware/signing');

const homeRouter = require('./routes/home');
const productsRouter = require('./routes/products');
const searchRouter = require('./routes/search');

const app = express();

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

// No compression middleware on purpose.
// No Cache-Control / ETag on purpose.

// Serve raw full-size product images from disk.
app.use('/images', express.static(path.join(__dirname, 'images'), { etag: false, lastModified: false }));

app.use('/home', homeRouter);
app.use('/products', productsRouter);
app.use('/search', searchRouter);

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`backend listening on :${port}`));
