'use strict';

// Customer routes (SPEC.md §5.4, §9.4). Authenticated only. The name is stored VERBATIM — no input
// sanitisation (§13 Never: sanitising here would delete the stored-XSS demo and teach the wrong fix).
// SECURE build: parameterized pool.execute everywhere. This is a file the vulnerable twin reverts.

const express = require('express');
const pool = require('../db/connection');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const COLUMNS = 'id, name, email, phone, sector, package, created_by, created_at';

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
      `SELECT ${COLUMNS} FROM customers WHERE id = ?`, [result.insertId]);
    return res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/customers — full list, newest first (re-rendered on every page load; §9.4).
router.get('/customers', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM customers ORDER BY id DESC`);
    return res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
