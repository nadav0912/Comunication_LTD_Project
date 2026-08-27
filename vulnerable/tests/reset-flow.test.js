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

// ---------- T12: reset / redemption + unlock ----------

async function issueToken(userId, email) {
  await request(app).post('/api/forgot').send({ email }).expect(200);
  const [rows] = await pool.execute('SELECT reset_token FROM users WHERE id = ?', [userId]);
  return rows[0].reset_token;
}
const login = (username, password) => request(app).post('/api/login').send({ username, password });

test('T12: a valid, unexpired token with a compliant password resets and enables login', async () => {
  const { username, userId, email } = await newUser('reset_ok');
  const token = await issueToken(userId, email);
  const res = await request(app).post('/api/reset').send({ token, newPassword: P_NEW });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });

  await login(username, P_NEW).expect(200);         // new password works
  await login(username, P0).expect(401);            // old password no longer works
  const [rows] = await pool.execute('SELECT reset_token FROM users WHERE id = ?', [userId]);
  assert.equal(rows[0].reset_token, null);          // token consumed
});

test('T12: an expired token returns 400 and the password is unchanged', async () => {
  const { username, userId, email } = await newUser('reset_expired');
  const token = await issueToken(userId, email);
  await pool.execute('UPDATE users SET reset_token_expires = TIMESTAMPADD(MINUTE, -1, NOW()) WHERE id = ?', [userId]);
  const res = await request(app).post('/api/reset').send({ token, newPassword: P_NEW });
  assert.equal(res.status, 400);
  await login(username, P0).expect(200);            // original password still valid
});

test('T12: an unknown or already-used token returns 400', async () => {
  await request(app).post('/api/reset')
    .send({ token: 'f'.repeat(40), newPassword: P_NEW }).expect(400);

  const { userId, email } = await newUser('reset_used');
  const token = await issueToken(userId, email);
  await request(app).post('/api/reset').send({ token, newPassword: P_NEW }).expect(200);
  await request(app).post('/api/reset').send({ token, newPassword: 'Hm9!kcrdfyGw' }).expect(400); // reused token
});

test('T12: a policy/history-violating new password returns 400 and does NOT consume the token', async () => {
  const { username, userId, email } = await newUser('reset_weak');
  const token = await issueToken(userId, email);
  await request(app).post('/api/reset').send({ token, newPassword: 'weak' }).expect(400);

  // token survives -> a compliant retry with the SAME token still works
  const res = await request(app).post('/api/reset').send({ token, newPassword: P_NEW });
  assert.equal(res.status, 200);
  await login(username, P_NEW).expect(200);
});

test('T12: redeeming a token on a locked account unlocks it (SC4 tail)', async () => {
  const { username, userId, email } = await newUser('reset_unlock');
  await pool.execute('UPDATE users SET is_locked = 1, failed_login_attempts = 3 WHERE id = ?', [userId]);
  await login(username, P0).expect(403);            // locked

  const token = await issueToken(userId, email);
  await request(app).post('/api/reset').send({ token, newPassword: P_NEW }).expect(200);

  const [rows] = await pool.execute('SELECT is_locked, failed_login_attempts FROM users WHERE id = ?', [userId]);
  assert.equal(rows[0].is_locked, 0);
  assert.equal(rows[0].failed_login_attempts, 0);
  await login(username, P_NEW).expect(200);         // unlocked + new password
});

test('T12: a reset that reuses a windowed password is rejected (shared history logic)', async () => {
  const { userId, email } = await newUser('reset_reuse');
  const token = await issueToken(userId, email);
  const res = await request(app).post('/api/reset').send({ token, newPassword: P0 }); // P0 still in window
  assert.equal(res.status, 400);
});
