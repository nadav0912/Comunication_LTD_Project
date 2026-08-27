'use strict';

// T3 — Express skeleton. DB-free: exercises static serving, the JSON 404, the leak-proof error
// middleware, and the session cookie policy (SPEC §8, §14, SC13). Runnable now with plain
// `node --test tests/server.test.js` — it needs no database and no .env.test.

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createApp, sessionOptions } = require('../server');
const errorHandler = require('../middleware/errorHandler');

test('GET / serves the static placeholder page', async () => {
  const res = await request(createApp()).get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /html/);
  assert.match(res.text, /Comunication_LTD/);
});

test('unknown /api route returns JSON 404, never HTML', async () => {
  const res = await request(createApp()).get('/api/nope');
  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.deepEqual(res.body, { error: 'Not found.' });
});

test('a thrown error returns 500, a generic message, and leaks no stack or SQL', async () => {
  const app = express();
  app.get('/boom', () => {
    throw new Error("ER_PARSE_ERROR: SELECT * FROM users WHERE username = 'x'");
  });
  app.use(errorHandler);

  const res = await request(app).get('/boom');
  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'An unexpected error occurred.');
  assert.doesNotMatch(JSON.stringify(res.body), /ER_PARSE_ERROR|SELECT|at Object|\.js:\d/);
});

test('session cookie policy is HttpOnly, SameSite=Lax', () => {
  const opts = sessionOptions();
  assert.equal(opts.cookie.httpOnly, true);
  assert.equal(opts.cookie.sameSite, 'lax');
  assert.equal(opts.saveUninitialized, false);
  assert.equal(opts.resave, false);
});
