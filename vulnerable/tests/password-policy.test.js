'use strict';

// T5 — password policy (SPEC.md §7). Pure over config.json + the dictionary file, no database —
// runnable now with `node --test tests/password-policy.test.js`. Includes the A1 proof (SC7): a
// runtime config edit changes behaviour with no restart. Config edits are made against the real
// config.json and always restored in `finally`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validatePassword, policy } = require('../services/passwordPolicy');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const ORIGINAL = fs.readFileSync(CONFIG_PATH, 'utf8');

function withConfig(patch, fn) {
  const cfg = { ...JSON.parse(ORIGINAL), ...patch };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  try {
    return fn();
  } finally {
    fs.writeFileSync(CONFIG_PATH, ORIGINAL);
  }
}

test('a strong, non-dictionary password passes clean', () => {
  const res = validatePassword('Kq7#mxzptvwR');
  assert.equal(res.valid, true, JSON.stringify(res.errors));
  assert.deepEqual(res.errors, []);
});

test('too-short password fails on length only', () => {
  const res = validatePassword('Kq7#mx'); // 6 chars, all classes present
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => /at least 10 characters/i.test(e)));
});

test('each complexity class reports its own error independently', () => {
  assert.ok(validatePassword('kq7#mxzptvwr').errors.some((e) => /uppercase/i.test(e)));
  assert.ok(validatePassword('KQ7#MXZPTVWR').errors.some((e) => /lowercase/i.test(e)));
  assert.ok(validatePassword('Kq#mxzptvwRs').errors.some((e) => /digit/i.test(e)));
  assert.ok(validatePassword('Kq7mxzptvwRs').errors.some((e) => /special/i.test(e)));
});

test('a common dictionary word is rejected', () => {
  const res = validatePassword('Password#1234'); // contains "password"
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => /common/i.test(e)));
});

test('a password violating three rules returns three errors at once', () => {
  const res = validatePassword('mxqzjfhwpl'); // 10 lowercase, no dict word: missing upper/digit/special
  assert.equal(res.valid, false);
  assert.equal(res.errors.length, 3);
});

test('policy() exposes historyCount and maxLoginAttempts', () => {
  const p = policy();
  assert.equal(p.historyCount, 3);
  assert.equal(p.maxLoginAttempts, 3);
});

test('A1/SC7: raising passwordLength to 14 rejects a 12-char password with no restart', () => {
  const twelve = 'Kq7#mxzptvwR'; // 12 chars, compliant at length 10
  assert.equal(validatePassword(twelve).valid, true);
  withConfig({ passwordLength: 14 }, () => {
    const res = validatePassword(twelve);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => /at least 14 characters/i.test(e)));
  });
  assert.equal(validatePassword(twelve).valid, true); // restored
});

test('disabling requireSpecialChars lets a no-special password pass with no restart', () => {
  const noSpecial = 'Kqmxztpvw12Q'; // upper/lower/digit, NO special
  assert.equal(validatePassword(noSpecial).valid, false);
  withConfig({
    complexity: {
      requireUppercase: true,
      requireLowercase: true,
      requireDigits: true,
      requireSpecialChars: false,
    },
  }, () => {
    assert.equal(validatePassword(noSpecial).valid, true);
  });
});
