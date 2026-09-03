'use strict';

// Password routes: change-password, forgot, reset
//
// !! INTENTIONALLY VULNERABLE !!
// VULNERABLE build: the forgot (email) and reset (token) lookups concatenate user input into the SQL
// via pool.query(). The secure twin binds them as parameters.

const express = require('express');
const pool = require('../db/connection');
const requireAuth = require('../middleware/requireAuth');
const { verifyPassword, generateResetToken } = require('../services/crypto');
const { changePassword } = require('../services/passwordService');
const mailer = require('../services/mailer');

const router = express.Router();

// POST /api/change-password 
// Verify the current password (timing-safe), then apply the shared policy+history+salt-rotation logic.
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

// POST /api/forgot 
// Look up by email, issue sha1(randomBytes(20)) as reset_token with a server-clock expiry, and email it.
// Always returns {ok:true} so it never reveals whether the email exists (no enumeration on this endpoint). 
// If the send fails, the just-issued token is cleared so nothing is left half-issued.
router.post('/forgot', async (req, res, next) => {
  try {
    const { email } = req.body ?? {};
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    // !! INTENTIONALLY VULNERABLE  !! (email concatenated into SQL)
    const [rows] = await pool.query(`SELECT id, email FROM users WHERE email = '${email}' LIMIT 1`);
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

// POST /api/reset 
// Match an unexpired token, apply the SAME policy+history+salt logic as change-password (shared changePassword and not a second copy), 
// then clear the token and unlock the account (is_locked=0, failed_login_attempts=0).
// If the new password fails policy/history the token is NOT consumed, so the user can retry.
router.post('/reset', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body ?? {};
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required.' });
    }

    // !! INTENTIONALLY VULNERABLE !! (token concatenated into SQL)
    const [rows] = await pool.query(
      `SELECT id FROM users WHERE reset_token = '${token}' AND reset_token_expires > NOW() LIMIT 1`,
    );
    const user = rows[0];
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token.' });

    const result = await changePassword(user.id, newPassword);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, details: result.details });
    }

    await pool.execute(
      'UPDATE users SET reset_token = NULL, reset_token_expires = NULL, is_locked = 0, failed_login_attempts = 0 WHERE id = ?',
      [user.id],
    );
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
