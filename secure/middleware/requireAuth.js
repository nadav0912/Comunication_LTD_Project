'use strict';

// Gate for authenticated-only routes. Returns 401 JSON unless
// the session carries a userId. Protects POST/GET /api/customers and change-password.
module.exports = function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Authentication required.' });
};
