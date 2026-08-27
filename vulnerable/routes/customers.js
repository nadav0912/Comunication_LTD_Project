'use strict';

// Customer routes (SPEC.md §5.4, §9.4, §10.2). Authenticated only. The name is stored VERBATIM — no
// input sanitisation (§13 Never: sanitising here would delete the stored-XSS demo).
//
// SECURE build: every query uses parameterized pool.execute — input travels as a bound value and can
// never be parsed as SQL. GET supports ?search= (name filter): this is the SELECT the UNION demo
// targets (§10.2), and the file the vulnerable twin reverts to string concatenation (T16).
//
// No template interpolation appears in any SQL string here — SC14 greps this directory for it.

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
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      const [rows] = await pool.execute(
        'SELECT id, name, email, phone, sector, package, created_by, created_at FROM customers WHERE name LIKE ? ORDER BY id DESC',
        ['%' + search + '%'],
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
