const bcrypt = require('bcrypt');

// Pretends to sign every request with a rotating token.
// Intentionally CPU-expensive (cost=12 is heavy for a hot path).
module.exports = function signing(req, res, next) {
  const payload = `${req.method}:${req.path}:${Date.now()}`;
  const signature = bcrypt.hashSync(payload, 12);
  res.setHeader('X-Request-Signature', signature.slice(0, 24));
  next();
};
