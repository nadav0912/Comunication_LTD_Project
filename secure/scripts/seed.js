'use strict';

// Demo seed. Idempotent: it resets the demo user to a known,
// unlocked state and a fixed set of customers on every run, so a locked/edited demo account is one
// `npm run db:seed` away from clean. Prints the credentials it created. Never touches __test_ rows.

require('dotenv').config(); // must precede db/connection so the pool reads DB_* from .env
const pool = require('../db/connection');
const { generateSalt, hashPassword } = require('../services/crypto');
const { validatePassword } = require('../services/passwordPolicy');

const DEMO = {
  username: 'demo',
  email: 'demo@comm-ltd.example',
  password: 'Comm7#Ltdxyz',
};
const DEMO_CUSTOMERS = [
  { name: 'Acme Corp', email: 'ops@acme.example', phone: '03-1112222', sector: 'Technology', package: 'Premium' },
  { name: 'Globex', email: 'it@globex.example', phone: '03-3334444', sector: 'Finance', package: 'Enterprise' },
  { name: 'Initech', email: 'admin@initech.example', phone: '03-5556666', sector: 'Business', package: 'Standard' },
];

async function main() {
  const check = validatePassword(DEMO.password);
  if (!check.valid) throw new Error(`demo password fails current policy: ${check.errors.join('; ')}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Reset any existing demo user cleanly (delete its customers first to avoid orphans, then the
    // user — which cascades its password_history), so re-seeding always lands the same state.
    const [existing] = await conn.execute('SELECT id FROM users WHERE username = ?', [DEMO.username]);
    if (existing[0]) {
      await conn.execute('DELETE FROM customers WHERE created_by = ?', [existing[0].id]);
      await conn.execute('DELETE FROM users WHERE id = ?', [existing[0].id]);
    }

    const salt = generateSalt();
    const passwordHash = hashPassword(DEMO.password, salt);
    const [ins] = await conn.execute(
      'INSERT INTO users (username, email, password_hash, salt) VALUES (?, ?, ?, ?)',
      [DEMO.username, DEMO.email, passwordHash, salt],
    );
    const demoId = ins.insertId;
    await conn.execute(
      'INSERT INTO password_history (user_id, password_hash, salt) VALUES (?, ?, ?)',
      [demoId, passwordHash, salt],
    );

    for (const c of DEMO_CUSTOMERS) {
      await conn.execute(
        'INSERT INTO customers (name, email, phone, sector, package, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [c.name, c.email, c.phone, c.sector, c.package, demoId],
      );
    }

    await conn.commit();
    console.log('db:seed ok — demo data reset.');
    console.log(`  login: ${DEMO.username} / ${DEMO.password}`);
    console.log(`  customers: ${DEMO_CUSTOMERS.map((c) => c.name).join(', ')}`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

main().then(() => pool.end()).catch((err) => {
  console.error(`db:seed FAILED [${err.code || 'ERR'}] ${err.message}`);
  pool.end();
  process.exitCode = 1;
});
