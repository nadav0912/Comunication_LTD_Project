'use strict';

// T10 — change-password + history (SPEC.md §9.2, §6/§7, plan A8). Reuse window = the last
// `historyCount` password_history rows INCLUDING the current password; salt is rotated on every
// change, so the reuse check is per-row (recompute HMAC(new, row.salt)). Runs live against the
// tree DB; fixtures prefixed __test_<runId>_ and removed in after().

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../server');
const pool = require('../db/connection');

const app = createApp();
const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const uname = (s) => `__test_${runId}_${s}`;
const P0 = 'Kq7#mxzptvwR';
const P1 = 'Zt4$wnbqxvLp';
const P2 = 'Hm9!kcrdfyGw';
const P3 = 'Bx2@vqzjmtRs';

async function newUser(suffix) {
  const username = uname(suffix);
  await request(app).post('/api/register')
    .send({ username, email: `${suffix}@ex.com`, password: P0 }).expect(201);
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username, password: P0 }).expect(200);
  const [[row]] = [await pool.execute('SELECT id FROM users WHERE username = ?', [username])];
  return { agent, username, userId: row[0].id };
}
const change = (agent, currentPassword, newPassword) =>
  agent.post('/api/change-password').send({ currentPassword, newPassword });

async function saltOf(userId) {
  const [rows] = await pool.execute('SELECT salt FROM users WHERE id = ?', [userId]);
  return rows[0].salt;
}

test.after(async () => {
  await pool.execute('DELETE FROM users WHERE username LIKE ?', [`__test_${runId}_%`]);
  await pool.end();
});

test('a wrong current password returns 401 and changes nothing', async () => {
  const { agent, userId } = await newUser('wrongcur');
  const before = await saltOf(userId);
  const res = await change(agent, 'Nope#12345Zz', P1);
  assert.equal(res.status, 401);
  assert.equal(await saltOf(userId), before);
});

test('a policy-violating new password returns 400 with details', async () => {
  const { agent } = await newUser('weaknew');
  const res = await change(agent, P0, 'weak');
  assert.equal(res.status, 400);
  assert.ok(Array.isArray(res.body.details) && res.body.details.length > 0);
});

test('SC5: reusing the immediately previous password is rejected', async () => {
  const { agent } = await newUser('reuse_prev');
  await change(agent, P0, P1).then((r) => assert.equal(r.status, 200));
  const res = await change(agent, P1, P0); // P0 is still in the last-3 window
  assert.equal(res.status, 400);
});

test('each change rotates the salt, and the reuse check fires against a differently-salted row', async () => {
  const { agent, userId } = await newUser('rotate');
  const salt0 = await saltOf(userId);
  await change(agent, P0, P1).then((r) => assert.equal(r.status, 200));
  const salt1 = await saltOf(userId);
  assert.notEqual(salt0, salt1); // salt rotated on change

  // reusing P0 is rejected even though the current salt (salt1) differs from P0's stored salt
  // (salt0) — proving per-row-salt verification (the discarded frozen-salt design would fail here)
  const [[p0row]] = [await pool.execute(
    'SELECT salt FROM password_history WHERE user_id = ? ORDER BY id ASC LIMIT 1', [userId])];
  assert.notEqual(p0row[0].salt, await saltOf(userId));
  const res = await change(agent, P1, P0);
  assert.equal(res.status, 400);
});

test('a password that has fallen out of the last-historyCount window is reusable again', async () => {
  const { agent, userId } = await newUser('window');
  // history holds one row per password; with historyCount=3, after 3 changes P0 is trimmed out
  await change(agent, P0, P1).then((r) => assert.equal(r.status, 200));
  await change(agent, P1, P2).then((r) => assert.equal(r.status, 200));
  await change(agent, P2, P3).then((r) => assert.equal(r.status, 200)); // window now {P1,P2,P3}

  // P1 is still in window -> rejected
  assert.equal((await change(agent, P3, P1)).status, 400);
  // P0 fell out of the window -> accepted
  assert.equal((await change(agent, P3, P0)).status, 200);

  // history never exceeds historyCount rows
  const [rows] = await pool.execute(
    'SELECT COUNT(*) c FROM password_history WHERE user_id = ?', [userId]);
  assert.ok(rows[0].c <= 3, `history has ${rows[0].c} rows, expected <= 3`);
});
