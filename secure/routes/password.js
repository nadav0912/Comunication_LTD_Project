'use strict';

// Password routes (SPEC.md §5.2/§5.5, §9.2/§9.5): change-password (T10), forgot (T11), reset (T12).
// SECURE build: parameterized pool.execute everywhere. Reverted to concatenation in the vuln twin.

const express = require('express');
const pool = require('../db/connection');
const requireAuth = require('../middleware/requireAuth');
const { verifyPassword, generateResetToken } = require('../services/crypto');
const { changePassword } = require('../services/passwordService');
const mailer = require('../services/mailer');

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

// POST /api/forgot (§9.5). Look up by email, issue sha1(randomBytes(20)) as reset_token with a
// server-clock expiry, and email it (deviation D3: emailed value == stored value). Always returns
// {ok:true} — it never reveals whether the email exists (no enumeration on this endpoint). If the
// send fails, the just-issued token is cleared so nothing is left half-issued.
router.post('/forgot', async (req, res, next) => {
  try {
    const { email } = req.body ?? {};
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const [rows] = await pool.execute('SELECT id, email FROM users WHERE email = ? LIMIT 1', [email]);
    const user = rows[0];

    if (user) {
      const ttl = Number(process.env.RESET_TOKEN_TTL_MINUTES) || 15;
      const token = generateResetToken();
      await pool.execute(
        'UPDATE users SET reset_token = ?, reset_token_expires = TIMESTAMPADD(MINUTE, ?, NOW()) WHERE id = ?',
        [token, ttl, user.id],
      );
      try {
        await mailer.sendResetEmail(user.email, token);
      } catch (err) {
        await pool.execute(
          'UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE id = ?', [user.id]);
        return next(err); // generic 500 — never leaks SMTP creds
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
