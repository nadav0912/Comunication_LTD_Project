'use strict';

// T4 — crypto primitives (SPEC.md §2, §9). Pure functions, no I/O — runnable now with
// `node --test tests/crypto.test.js`, no database or .env needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateSalt,
  hashPassword,
  verifyPassword,
  generateResetToken,
} = require('../services/crypto');

test('hashPassword is deterministic and returns 64 hex chars', () => {
  const salt = 'a'.repeat(32);
  const h1 = hashPassword('S3cret!pass', salt);
  const h2 = hashPassword('S3cret!pass', salt);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('the same password under two salts yields different hashes', () => {
  assert.notEqual(hashPassword('S3cret!pass', generateSalt()), hashPassword('S3cret!pass', generateSalt()));
});

test('generateSalt returns 32 hex chars and differs across calls', () => {
  const s1 = generateSalt();
  const s2 = generateSalt();
  assert.match(s1, /^[0-9a-f]{32}$/);
  assert.notEqual(s1, s2);
});

test('verifyPassword accepts the right password and rejects the wrong one', () => {
  const salt = generateSalt();
  const hash = hashPassword('correct horse', salt);
  assert.equal(verifyPassword('correct horse', salt, hash), true);
  assert.equal(verifyPassword('wrong horse', salt, hash), false);
});

test('verifyPassword returns false, not throws, on a length-mismatched hash', () => {
  const salt = generateSalt();
  assert.doesNotThrow(() => verifyPassword('x', salt, 'deadbeef'));
  assert.equal(verifyPassword('x', salt, 'deadbeef'), false);
  assert.equal(verifyPassword('x', salt, ''), false);
});

test('generateResetToken returns 40 hex chars and differs across calls', () => {
  const t1 = generateResetToken();
  const t2 = generateResetToken();
  assert.match(t1, /^[0-9a-f]{40}$/);
  assert.notEqual(t1, t2);
});
