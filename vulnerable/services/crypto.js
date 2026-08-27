'use strict';

// Password and token primitives (SPEC.md §2, §9). Deliberate deviation D2: HMAC-SHA256 is FAST and
// therefore weak against an offline brute force of a stolen database — bcrypt/scrypt/Argon2 are the
// correct production choice. The brief mandates HMAC, so that is what ships; the report explains why.
// Deviation D3: the reset token is SHA-1 and the emailed value equals the stored value.

const crypto = require('crypto');

// 16 random bytes -> 32 hex chars (SPEC §6 users.salt CHAR(32)).
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

// HMAC-SHA256 with the salt as key -> 64 hex chars (SPEC §6 password_hash CHAR(64)).
function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(String(password), 'utf8').digest('hex');
}

// Constant-time comparison. Never throws: a malformed or wrong-length stored hash returns false
// rather than letting timingSafeEqual throw on unequal buffer lengths.
function verifyPassword(password, salt, expectedHash) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(String(expectedHash), 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

// SHA-1 of 20 random bytes -> 40 hex chars (SPEC §6 reset_token CHAR(40), §9.5).
function generateResetToken() {
  return crypto.createHash('sha1').update(crypto.randomBytes(20)).digest('hex');
}

module.exports = { generateSalt, hashPassword, verifyPassword, generateResetToken };
