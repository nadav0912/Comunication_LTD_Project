'use strict';

// Auth routes. JSON only — never returns HTML.
// SECURE build: every query uses pool.execute(sql, params) — input travels as a bound parameter and
// can never be parsed as SQL. This is the file the vulnerable twin reverts to string concatenation.

const express = require('express');
const pool = require('../db/connection');
const { generateSalt, hashPassword, verifyPassword } = require('../services/crypto');
const { validatePassword, policy } = require('../services/passwordPolicy');

const router = express.Router();

// POST /api/register
// Validate policy -> salt -> HMAC -> insert user -> insert the SAME
// (hash, salt) pair as the first password_history row, in one transaction so the invariant "one
// history row per password" can never be left half-written.
router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password } = req.body ?? {};
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email and password are required.' });
    }

    const check = validatePassword(password);
    if (!check.valid) {
      return res.status(400).json({ error: 'Password does not meet the policy.', details: check.errors });
    }

    const salt = generateSalt();
    const passwordHash = hashPassword(password, salt);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(
        'INSERT INTO users (username, email, password_hash, salt) VALUES (?, ?, ?, ?)',
        [username, email, passwordHash, salt],
      );
      const userId = result.insertId;
      await conn.execute(
        'INSERT INTO password_history (user_id, password_hash, salt) VALUES (?, ?, ?)',
        [userId, passwordHash, salt],
      );
      await conn.commit();
      return res.status(201).json({ id: userId, username });
    } catch (err) {
      await conn.rollback();
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Username already exists.' });
      }
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/login. Parameterized lookup.
// an unknown username is reported distinctly ("User does not exist.") because the brief requires it — the report notes the
// safe alternative. On a wrong password the failed-attempt counter is bumped and the account locks
// at config.maxLoginAttempts. On success the counter resets and the session id is regenerated (fixation defence).
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const [rows] = await pool.execute(
      'SELECT id, password_hash, salt, failed_login_attempts, is_locked FROM users WHERE username = ?',
      [username],
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'User does not exist.' }); // D1

    if (user.is_locked) {
      return res.status(403).json({ error: 'Account locked. Use "Forgot password" to unlock.' });
    }

    if (!verifyPassword(password, user.salt, user.password_hash)) {
      const attempts = user.failed_login_attempts + 1;
      const locked = attempts >= policy().maxLoginAttempts ? 1 : 0;
      await pool.execute(
        'UPDATE users SET failed_login_attempts = ?, is_locked = ? WHERE id = ?',
        [attempts, locked, user.id],
      );
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    await pool.execute('UPDATE users SET failed_login_attempts = 0 WHERE id = ?', [user.id]);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.username = username;
      res.json({ username });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/logout
router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.status(204).end();
  });
});

// GET /api/me — session probe for the client
router.get('/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ username: req.session.username });
  }
  return res.status(401).json({ error: 'Not authenticated.' });
});

module.exports = router;
