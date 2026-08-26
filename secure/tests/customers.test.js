'use strict';

// T9 — customers API (SPEC.md §5.4, §9.4). The name is stored VERBATIM in both builds; escaping is
// an output concern (textContent in secure, innerHTML in vulnerable). This suite proves storage is
// byte-identical — the render half of the XSS demo is a manual browser check (docs/attack-report).
// Fixtures prefixed __test_<runId>_ on both username and customers.name; deleted in after() (A6).

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../server');
const pool = require('../db/connection');

const app = createApp();
const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const uname = (s) => `__test_${runId}_${s}`;
const cname = (s) => `__test_${runId}_${s}`;
const VALID_PW = 'Kq7#mxzptvwR';

async function authedAgent(suffix) {
  const username = uname(suffix);
  await request(app).post('/api/register')
    .send({ username, email: `${suffix}@ex.com`, password: VALID_PW }).expect(201);
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username, password: VALID_PW }).expect(200);
  return { agent, username };
}

test.after(async () => {
  await pool.execute('DELETE FROM customers WHERE name LIKE ?', [`__test_${runId}_%`]);
  await pool.execute('DELETE FROM users WHERE username LIKE ?', [`__test_${runId}_%`]);
  await pool.end();
});

test('unauthenticated POST and GET /api/customers return 401', async () => {
  await request(app).get('/api/customers').expect(401);
  await request(app).post('/api/customers').send({ name: cname('x') }).expect(401);
});

test('POST creates a customer; GET returns it on a later request and a later session', async () => {
  const { agent } = await authedAgent('cust_create');
  const name = cname('acme');
  const created = await agent.post('/api/customers')
    .send({ name, email: 'a@ex.com', phone: '123', sector: 'tech', package: 'basic' });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, name);
  assert.ok(Number.isInteger(created.body.id));

  const { agent: agent2 } = await authedAgent('cust_view'); // fresh login = later session
  const list = await agent2.get('/api/customers');
  assert.equal(list.status, 200);
  assert.ok(list.body.some((c) => c.id === created.body.id && c.name === name));
});

test('a stored-XSS payload is stored byte-identically (escaping is the render job, not storage)', async () => {
  const { agent } = await authedAgent('xss');
  const name = cname('<img src=x onerror=alert(1)>');
  const created = await agent.post('/api/customers').send({ name });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, name); // verbatim in the API response

  const [rows] = await pool.execute('SELECT name FROM customers WHERE id = ?', [created.body.id]);
  assert.equal(rows[0].name, name); // verbatim in the database — no input sanitisation (§13 Never)
});

test('missing name returns 400', async () => {
  const { agent } = await authedAgent('noname');
  await agent.post('/api/customers').send({ email: 'a@ex.com' }).expect(400);
});
