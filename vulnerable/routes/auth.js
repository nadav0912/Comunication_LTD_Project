'use strict';

// Auth routes (SPEC.md §5.1/§5.3, §9.1/§9.3). JSON only — never returns HTML.
//
// !! INTENTIONALLY VULNERABLE — see SPEC.md §10.2 !!
// VULNERABLE build: the login queries concatenate the username straight into the SQL text via
// pool.query(), so `' OR '1'='1' -- ` rewrites the WHERE clause. The secure twin uses
// pool.execute(sql, params) instead. multipleStatements stays false (db/connection.js), so the demo
// relies on OR/UNION, never stacked statements.

const express = require('express');
const pool = require('../db/connection');
const { generateSalt, hashPassword, verifyPassword } = require('../services/crypto');
const { validatePassword, policy } = require('../services/passwordPolicy');

const router = express.Router();

// POST /api/register (§9.1). Validate policy -> salt -> HMAC -> insert user -> insert the SAME
// (hash, salt) pair as the first password_history row, in one transaction so the invariant "one
// history row per password" (plan A8) can never be left half-written.
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

// POST /api/login (§9.3, §10.2). Deviation D1: an unknown username is reported distinctly.
//
// !! INTENTIONALLY VULNERABLE — see SPEC.md §10.2 !!
// Because passwords are salted per user, the credential check is a SECOND concatenated query
// (username + password_hash). The trailing `-- ` in `' OR '1'='1' -- ` comments out the
// ` AND password_hash = '...'` condition, so ANY password authenticates and login is bypassed.
// The lockout counter still works for a genuine wrong password (both queries are string-built).
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    // !! INTENTIONALLY VULNERABLE — see SPEC.md §10.2 !! (username concatenated into SQL)
    const [rows] = await pool.query(
      `SELECT id, salt, is_locked, failed_login_attempts FROM users WHERE username = '${username}'`,
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'User does not exist.' }); // D1

    if (user.is_locked) {
      return res.status(403).json({ error: 'Account locked. Use "Forgot password" to unlock.' });
    }

    // !! INTENTIONALLY VULNERABLE — see SPEC.md §10.2 !!
    // The password check lives in the SQL; `' OR '1'='1' -- ` comments out the password_hash clause.
    const candidateHash = hashPassword(password, user.salt);
    const [authRows] = await pool.query(
      `SELECT id FROM users WHERE username = '${username}' AND password_hash = '${candidateHash}'`,
    );

    if (!authRows[0]) {
      const attempts = user.failed_login_attempts + 1;
      const locked = attempts >= policy().maxLoginAttempts ? 1 : 0;
      await pool.query(
        `UPDATE users SET failed_login_attempts = ${attempts}, is_locked = ${locked} WHERE id = ${user.id}`,
      );
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    const authedId = authRows[0].id;
    await pool.query(`UPDATE users SET failed_login_attempts = 0 WHERE id = ${authedId}`);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = authedId;
      req.session.username = username;
      res.json({ username });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/logout (§5.3).
router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.status(204).end();
  });
});

// GET /api/me — session probe for the client (§8).
router.get('/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ username: req.session.username });
  }
  return res.status(401).json({ error: 'Not authenticated.' });
});

module.exports = router;
