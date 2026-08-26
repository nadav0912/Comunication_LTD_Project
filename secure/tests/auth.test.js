'use strict';

// T6/T7/T8 — auth API (register, login, lockout). Runs against the tree's own database
// (secure_app_db) via --env-file=.env.test. No TRUNCATE (plan A6): every fixture is prefixed
// `__test_<runId>_` and removed in after(); assertions scope to the rows this run created.

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../server');
const pool = require('../db/connection');

const app = createApp();
const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const uname = (s) => `__test_${runId}_${s}`;
const VALID_PW = 'Kq7#mxzptvwR'; // compliant, non-dictionary

test.after(async () => {
  await pool.execute('DELETE FROM users WHERE username LIKE ?', [`__test_${runId}_%`]);
  await pool.end();
});

// ---------- T6: register ----------

test('POST /api/register creates a user and its first history row', async () => {
  const username = uname('reg');
  const res = await request(app).post('/api/register')
    .send({ username, email: 'reg@example.com', password: VALID_PW });
  assert.equal(res.status, 201);
  assert.equal(res.body.username, username);
  assert.ok(Number.isInteger(res.body.id));

  const [rows] = await pool.execute('SELECT password_hash, salt FROM users WHERE id = ?', [res.body.id]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].password_hash, /^[0-9a-f]{64}$/);
  assert.match(rows[0].salt, /^[0-9a-f]{32}$/);

  // history holds exactly one row for a new user, matching the users pair (plan A8, §6)
  const [hist] = await pool.execute(
    'SELECT password_hash, salt FROM password_history WHERE user_id = ?', [res.body.id]);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].password_hash, rows[0].password_hash);
  assert.equal(hist[0].salt, rows[0].salt);
});

test('a policy-violating password returns 400 with details and creates no user', async () => {
  const username = uname('weak');
  const res = await request(app).post('/api/register')
    .send({ username, email: 'weak@example.com', password: 'weak' });
  assert.equal(res.status, 400);
  assert.ok(Array.isArray(res.body.details) && res.body.details.length > 0);
  const [rows] = await pool.execute('SELECT id FROM users WHERE username = ?', [username]);
  assert.equal(rows.length, 0);
});

test('a duplicate username returns 409', async () => {
  const username = uname('dup');
  await request(app).post('/api/register')
    .send({ username, email: 'a@example.com', password: VALID_PW }).expect(201);
  const res = await request(app).post('/api/register')
    .send({ username, email: 'b@example.com', password: VALID_PW });
  assert.equal(res.status, 409);
});

test('missing fields return 400', async () => {
  const res = await request(app).post('/api/register').send({ username: uname('nofields') });
  assert.equal(res.status, 400);
});

test('the response never leaks password_hash or salt', async () => {
  const res = await request(app).post('/api/register')
    .send({ username: uname('leak'), email: 'leak@example.com', password: VALID_PW });
  assert.doesNotMatch(JSON.stringify(res.body), /password_hash|salt/);
});

// ---------- T7: login / logout / me ----------

function sidOf(res) {
  const cookies = res.headers['set-cookie'] || [];
  const sid = cookies.find((c) => c.startsWith('connect.sid='));
  return sid ? sid.split(';')[0] : null;
}

async function registerUser(suffix) {
  const username = uname(suffix);
  await request(app).post('/api/register')
    .send({ username, email: `${suffix}@example.com`, password: VALID_PW }).expect(201);
  return username;
}

test('correct credentials return 200 {username} and set a session cookie', async () => {
  const username = await registerUser('login_ok');
  const res = await request(app).post('/api/login').send({ username, password: VALID_PW });
  assert.equal(res.status, 200);
  assert.equal(res.body.username, username);
  assert.ok(sidOf(res), 'expected a session cookie');
});

test('an unknown username returns 401 with the distinct D1 message', async () => {
  const res = await request(app).post('/api/login')
    .send({ username: uname('ghost'), password: VALID_PW });
  assert.equal(res.status, 401);
  assert.match(res.body.error, /does not exist/i);
});

test('a wrong password returns 401 with a distinct message', async () => {
  const username = await registerUser('login_wrong');
  const res = await request(app).post('/api/login').send({ username, password: 'Wrong#12345Zz' });
  assert.equal(res.status, 401);
  assert.match(res.body.error, /incorrect password/i);
  assert.doesNotMatch(res.body.error, /does not exist/i);
});

test('GET /api/me is 401 without a session and 200 {username} with one', async () => {
  const username = await registerUser('me');
  const agent = request.agent(app);
  await agent.get('/api/me').expect(401);
  await agent.post('/api/login').send({ username, password: VALID_PW }).expect(200);
  const me = await agent.get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.username, username);
});

test('logout returns 204 and a subsequent /api/me is 401', async () => {
  const username = await registerUser('logout');
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username, password: VALID_PW }).expect(200);
  await agent.post('/api/logout').expect(204);
  await agent.get('/api/me').expect(401);
});

test('the session id is regenerated on login (fixation defence)', async () => {
  const username = await registerUser('regen');
  const agent = request.agent(app);
  const first = await agent.post('/api/login').send({ username, password: VALID_PW });
  const second = await agent.post('/api/login').send({ username, password: VALID_PW });
  assert.ok(sidOf(first) && sidOf(second));
  assert.notEqual(sidOf(first), sidOf(second));
});
