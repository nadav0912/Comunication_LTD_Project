'use strict';

// Auth routes (SPEC.md §5.1/§5.3, §9.1/§9.3). JSON only — never returns HTML.
// SECURE build: every query uses pool.execute(sql, params) — input travels as a bound parameter and
// can never be parsed as SQL. This is the file the vulnerable twin reverts to string concatenation.

const express = require('express');
const pool = require('../db/connection');
const { generateSalt, hashPassword } = require('../services/crypto');
const { validatePassword } = require('../services/passwordPolicy');

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

module.exports = router;
