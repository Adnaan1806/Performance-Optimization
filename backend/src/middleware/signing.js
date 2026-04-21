const crypto = require('crypto');

const SECRET = process.env.SIGNING_SECRET || 'dev-secret';

module.exports = function signing(req, res, next) {
  const payload = `${req.method}:${req.path}:${Date.now()}`;
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  res.setHeader('X-Request-Signature', signature.slice(0, 24));
  next();
};
