'use strict';

// Customer routes

// !! INTENTIONALLY VULNERABLE !!
// VULNERABLE build: GET ?search= concatenates the term into a LIKE clause via pool.query(), so
// `' UNION SELECT id, username, password_hash, salt, ... FROM users -- ` leaks the users table.
// The secure twin binds the term as a parameter. The name is still stored VERBATIM in both builds
// (the XSS demo lives at render, not storage).

const express = require('express');
const pool = require('../db/connection');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// POST /api/customers — create, returning the stored row (the response name is the XSS carrier).
router.post('/customers', requireAuth, async (req, res, next) => {
  try {
    const { name, email, phone, sector, package: pkg } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'Customer name is required.' });

    const [result] = await pool.execute(
      'INSERT INTO customers (name, email, phone, sector, package, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email ?? null, phone ?? null, sector ?? null, pkg ?? null, req.session.userId],
    );
    const [rows] = await pool.execute(
      'SELECT id, name, email, phone, sector, package, created_by, created_at FROM customers WHERE id = ?',
      [result.insertId],
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/customers[?search=term] — full list, or filtered by name. The search term is a BOUND
// parameter; the % wildcards wrap the value, never the SQL (this is the vulnerable twin's injection
// point once it reverts to concatenation).
router.get('/customers', requireAuth, async (req, res, next) => {
  try {
    // Not trimmed (unlike secure): the raw term — including a trailing `-- ` comment — reaches SQL.
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    if (search) {
      // !! INTENTIONALLY VULNERABLE !! (search term concatenated into SQL)
      const [rows] = await pool.query(
        `SELECT id, name, email, phone, sector, package, created_by, created_at FROM customers WHERE name LIKE '%${search}%' ORDER BY id DESC`,
      );
      return res.json(rows);
    }
    const [rows] = await pool.execute(
      'SELECT id, name, email, phone, sector, package, created_by, created_at FROM customers ORDER BY id DESC',
    );
    return res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
