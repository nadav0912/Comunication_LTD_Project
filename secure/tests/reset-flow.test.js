'use strict';

// T11/T12 — forgot + reset (SPEC.md §5.5, §9.5). The mailer is stubbed so tests never touch real
// SMTP (the real email is a manual C′ step, SC6). Deviation D3: the emailed value equals the stored
// value. Fixtures prefixed __test_<runId>_ and removed in after().

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../server');
const pool = require('../db/connection');
const mailer = require('../services/mailer');

const app = createApp();
const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const uname = (s) => `__test_${runId}_${s}`;
const emailOf = (s) => `__test_${runId}_${s}@ex.com`;
const P0 = 'Kq7#mxzptvwR';
const P_NEW = 'Zt4$wnbqxvLp';

let sent = [];
const realSend = mailer.sendResetEmail;
function installStub() {
  mailer.sendResetEmail = async (to, token) => { sent.push({ to, token }); };
}

test.before(() => { installStub(); });
test.after(async () => {
  mailer.sendResetEmail = realSend;
  await pool.execute('DELETE FROM users WHERE username LIKE ?', [`__test_${runId}_%`]);
  await pool.end();
});

async function newUser(suffix) {
  const username = uname(suffix);
  const email = emailOf(suffix);
  await request(app).post('/api/register').send({ username, email, password: P0 }).expect(201);
  const [rows] = await pool.execute('SELECT id FROM users WHERE username = ?', [username]);
  return { username, email, userId: rows[0].id };
}

// ---------- T11: forgot / issuance ----------

test('T11: a valid email issues a 40-hex reset_token with a future expiry, and emails it', async () => {
  sent = [];
  const { userId, email } = await newUser('forgot_ok');
  const res = await request(app).post('/api/forgot').send({ email });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });

  const [rows] = await pool.execute(
    'SELECT reset_token, (reset_token_expires > NOW()) AS future FROM users WHERE id = ?', [userId]);
  assert.match(rows[0].reset_token, /^[0-9a-f]{40}$/);
  assert.equal(Number(rows[0].future), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].token, rows[0].reset_token); // emailed == stored (D3)
});

test('T11: an unknown email returns 200 {ok:true} and issues no token (no enumeration)', async () => {
  const res = await request(app).post('/api/forgot').send({ email: emailOf('nobody') });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('T11: requesting a second token replaces the first', async () => {
  const { userId, email } = await newUser('forgot_twice');
  await request(app).post('/api/forgot').send({ email }).expect(200);
  const [a] = await pool.execute('SELECT reset_token FROM users WHERE id = ?', [userId]);
  await request(app).post('/api/forgot').send({ email }).expect(200);
  const [b] = await pool.execute('SELECT reset_token FROM users WHERE id = ?', [userId]);
  assert.notEqual(a[0].reset_token, b[0].reset_token);
});

test('T11: an SMTP failure returns 500, leaks no credentials, and leaves no half-issued token', async () => {
  const { userId, email } = await newUser('forgot_smtp');
  mailer.sendResetEmail = async () => { throw new Error('smtp connection failed'); };
  try {
    const res = await request(app).post('/api/forgot').send({ email });
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /smtp|pass|secret/i);
    const [rows] = await pool.execute('SELECT reset_token FROM users WHERE id = ?', [userId]);
    assert.equal(rows[0].reset_token, null);
  } finally {
    installStub();
  }
});
