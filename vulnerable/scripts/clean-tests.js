'use strict';

// Remove leftover test fixtures from a crashed run (SPEC.md §3, plan risk R4b). Deletes ONLY rows
// whose username / customers.name begins with the `__test_` prefix, so demo and real data are never
// touched. Reports the counts removed.

require('dotenv').config(); // must precede db/connection so the pool reads DB_* from .env
const pool = require('../db/connection');

async function main() {
  // Escape every underscore so LIKE matches the literal `__test_` prefix, not the _ wildcard.
  const [customers] = await pool.execute("DELETE FROM customers WHERE name LIKE '\\_\\_test\\_%'");
  const [users] = await pool.execute("DELETE FROM users WHERE username LIKE '\\_\\_test\\_%'");
  console.log(`db:clean-tests ok — removed ${users.affectedRows} user(s) and ${customers.affectedRows} customer(s) with the __test_ prefix.`);
}

main().then(() => pool.end()).catch((err) => {
  console.error(`db:clean-tests FAILED [${err.code || 'ERR'}] ${err.message}`);
  pool.end();
  process.exitCode = 1;
});
