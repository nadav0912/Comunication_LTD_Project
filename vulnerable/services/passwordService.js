'use strict';

// Shared password-change logic. 
// Used by BOTH change-password and reset — one function, not two copies, so history/salt semantics can never drift.
//
// Model: one password_history row per password, written when it becomes active; the current password
// is the newest row. The reuse window is the last `historyCount` rows (current included). Salt is
// rotated on every change, so reuse is checked PER ROW: recompute HMAC(candidate, row.salt).

const pool = require('../db/connection');
const { generateSalt, hashPassword } = require('./crypto');
const { validatePassword, policy } = require('./passwordPolicy');

// Newest-first history rows for a user (small — trimmed to historyCount after each write).
async function historyRows(conn, userId) {
  const [rows] = await conn.execute(
    'SELECT id, password_hash, salt FROM password_history WHERE user_id = ? ORDER BY created_at DESC, id DESC',
    [userId],
  );
  return rows;
}

// True if `candidate` matches any of the last `historyCount` stored passwords (per-row salt).
function isReused(rows, historyCount, candidate) {
  return rows.slice(0, historyCount).some((row) => hashPassword(candidate, row.salt) === row.password_hash);
}

// Validate policy + history, then set the new password with a FRESH salt and trim old history rows.
// Identity (current password or a valid reset token) must already be established by the caller.
// Returns { ok: true } or { ok: false, status, error, details? } for the route to map to HTTP.
async function changePassword(userId, newPassword) {
  const check = validatePassword(newPassword);
  if (!check.valid) {
    return { ok: false, status: 400, error: 'Password does not meet the policy.', details: check.errors };
  }
  const historyCount = policy().historyCount;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const rows = await historyRows(conn, userId);
    if (isReused(rows, historyCount, newPassword)) {
      await conn.rollback();
      return { ok: false, status: 400, error: `Password was used recently; choose one not among your last ${historyCount}.` };
    }

    const salt = generateSalt();
    const passwordHash = hashPassword(newPassword, salt);
    await conn.execute('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?', [passwordHash, salt, userId]);
    await conn.execute(
      'INSERT INTO password_history (user_id, password_hash, salt) VALUES (?, ?, ?)',
      [userId, passwordHash, salt],
    );

    // Trim rows beyond historyCount (keep the newest, including the row just inserted).
    const after = await historyRows(conn, userId);
    const staleIds = after.slice(historyCount).map((r) => r.id);
    if (staleIds.length) {
      const placeholders = staleIds.map(() => '?').join(',');
      await conn.execute(`DELETE FROM password_history WHERE id IN (${placeholders})`, staleIds);
    }

    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { changePassword };
