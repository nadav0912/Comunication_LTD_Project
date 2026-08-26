'use strict';

// Password policy (SPEC.md §7). Enforced entirely server-side; client validation is UX only.
//
// config.json is re-read on EVERY call (plan A5 — no mtime cache). The file is ~200 bytes, so a
// readFileSync per validation is free, and it removes a real flake: two writes inside one filesystem
// timestamp tick would make an mtime cache serve stale policy and fail the A1 test intermittently.
// The dictionary is static during a run, so it is loaded once.
//
// validatePassword returns EVERY violation at once ({ valid, errors: [...] }) so the UI can list them.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const DICT_PATH = path.join(__dirname, '..', 'data', 'common-passwords.txt');

// Special-character set per SPEC §7.
const SPECIALS = "!@#$%^&*()-_=+[]{};:'\",.<>/?\\|`~";

const dictionary = loadDictionary();

function loadDictionary() {
  try {
    return fs.readFileSync(DICT_PATH, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Returns the current policy object, re-read from disk (plan A5). Also the accessor T8/T10 use for
// maxLoginAttempts / historyCount.
function policy() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// Reject if the whole password is a listed entry, or contains any listed word of length >= 4.
function isDictionaryWeak(password) {
  const lower = password.toLowerCase();
  for (const word of dictionary) {
    if (word === lower) return true;
    if (word.length >= 4 && lower.includes(word)) return true;
  }
  return false;
}

function validatePassword(password) {
  const cfg = policy();
  const pw = typeof password === 'string' ? password : '';
  const errors = [];

  if (pw.length < cfg.passwordLength) {
    errors.push(`Password must be at least ${cfg.passwordLength} characters long.`);
  }

  const c = cfg.complexity || {};
  if (c.requireUppercase && !/[A-Z]/.test(pw)) errors.push('Password must contain an uppercase letter.');
  if (c.requireLowercase && !/[a-z]/.test(pw)) errors.push('Password must contain a lowercase letter.');
  if (c.requireDigits && !/[0-9]/.test(pw)) errors.push('Password must contain a digit.');
  if (c.requireSpecialChars && ![...pw].some((ch) => SPECIALS.includes(ch))) {
    errors.push('Password must contain a special character.');
  }

  if (cfg.blockDictionaryWords && isDictionaryWeak(pw)) {
    errors.push('Password is too common or contains a common dictionary word.');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { policy, validatePassword, SPECIALS };
