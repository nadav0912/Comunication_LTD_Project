'use strict';

// T13 — the NEGATIVE half of the asymmetric suite (SPEC.md §12, §10). The §10 attack payloads are
// sent as raw HTTP and MUST fail here. The vulnerable twin ships the mirror file asserting the same
// payloads SUCCEED — a green secure suite and a green vulnerable suite together are the evidence.
// Fixtures prefixed __test_<runId>_ and removed in after().

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../server');
const pool = require('../db/connection');

const app = createApp();
const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const uname = (s) => `__test_${runId}_${s}`;
const VALID_PW = 'Kq7#mxzptvwR';

// A canary user with a KNOWN password, so a UNION leak of users would be detectable.
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

test('SC12: SQLi auth-bypass is refused', async () => {
  const res = await request(app).post('/api/login')
    .send({ username: "' OR '1'='1' -- ", password: 'anything' });
  assert.equal(res.status, 401); // parameterized: the payload matches no username
  assert.equal(res.body.username, undefined);
});

test('SC12: a stacked/OR SQLi in the password field cannot bypass login', async () => {
  const res = await request(app).post('/api/login')
    .send({ username: canary.username, password: "' OR '1'='1" });
  assert.equal(res.status, 401);
});

test('SC12 (§1): SQLi in the register form does not inject (parameterized)', async () => {
  const marker = `inj_${runId}@evil.example`;
  const injectedUser = uname('regsec');
  const payload = `${injectedUser}', '${marker}', 'x', 'y') -- `;
  await request(app).post('/api/register')
    .send({ username: payload, email: 'real@example.com', password: VALID_PW });
  // The username is a bound parameter, never parsed — no user gets the injected marker email.
  const [rows] = await pool.execute('SELECT id FROM users WHERE email = ?', [marker]);
  assert.equal(rows.length, 0);
});

test('SC12: a UNION payload in customer search leaks no users columns', async () => {
  const payload = "' UNION SELECT id, username, password_hash, salt, 1, 1, 1, NOW() FROM users -- ";
  const res = await canary.agent.get('/api/customers?search=' + encodeURIComponent(payload));
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));

  const body = JSON.stringify(res.body);
  assert.doesNotMatch(body, /[0-9a-f]{64}/);          // no 64-hex hash surfaced
  assert.doesNotMatch(body, /password_hash|"salt"/);   // no users columns
  assert.ok(!res.body.some((c) => c.name === canary.username)); // no users row leaked as a "customer"
});

test('stored XSS payload round-trips byte-identically (stored verbatim, escaped at render)', async () => {
  const name = uname('xss') + '<img src=x onerror="alert(document.cookie)">';
  const created = await canary.agent.post('/api/customers').send({ name });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, name);

  const list = await canary.agent.get('/api/customers');
  const found = list.body.find((c) => c.id === created.body.id);
  assert.equal(found.name, name); // returned as data; escaping is the client's textContent job
});

test('SC13: no response leaks a hash, salt, stack frame, or raw SQL error', async () => {
  const bodies = [];
  bodies.push((await request(app).post('/api/login')
    .send({ username: canary.username, password: 'wrongpw' })).text);
  bodies.push((await request(app).post('/api/login')
    .send({ username: "' OR '1'='1' -- ", password: 'x' })).text);
  bodies.push((await request(app).post('/api/register')
    .send({ username: uname('leakcheck'), email: 'l@ex.com', password: VALID_PW })).text);
  bodies.push((await canary.agent.get('/api/customers')).text);

  for (const body of bodies) {
    assert.doesNotMatch(body, /password_hash|"salt"|at Object\.|ER_[A-Z]/);
  }
});
