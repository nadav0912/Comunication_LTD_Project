'use strict';

// Password routes (SPEC.md §5.2/§5.5, §9.2/§9.5): change-password (T10), forgot (T11), reset (T12).
// SECURE build: parameterized pool.execute everywhere. Reverted to concatenation in the vuln twin.

const express = require('express');
const pool = require('../db/connection');
const requireAuth = require('../middleware/requireAuth');
const { verifyPassword } = require('../services/crypto');
const { changePassword } = require('../services/passwordService');

const router = express.Router();

// POST /api/change-password (§9.2). Verify the current password (timing-safe), then apply the
// shared policy+history+salt-rotation logic.
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required.' });
    }

    const [rows] = await pool.execute(
      'SELECT password_hash, salt FROM users WHERE id = ?', [req.session.userId]);
    const user = rows[0];
    if (!user || !verifyPassword(currentPassword, user.salt, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const result = await changePassword(req.session.userId, newPassword);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, details: result.details });
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
