'use strict';

// Preflight connectivity check (SPEC.md §4, §15). Written now, RUN JOINTLY with the developer at
// Checkpoint C′ — it turns the live-connection session into one command instead of an afternoon of
// guessing. Proves two things and nothing else: the RDS TLS handshake + a trivial query, and that
// Gmail SMTP will accept the credentials. It NEVER prints DB_PASSWORD or SMTP_PASS (T1 criterion),
// including anything a driver may have embedded in an error message — see redact().

require('dotenv').config();
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const { sslConfig } = require('../db/ssl');

// Any secret that must never reach the console, even inside a thrown driver error object.
const SECRETS = [process.env.DB_PASSWORD, process.env.SMTP_PASS].filter(Boolean);

function redact(text) {
  let out = String(text);
  for (const secret of SECRETS) {
    out = out.split(secret).join('***');
  }
  return out;
}

// The security-group rule is keyed on the developer's public IP, so a DB failure must name it.
async function publicIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=text', { signal: AbortSignal.timeout(5000) });
    return res.ok ? (await res.text()).trim() : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function checkDb() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      // Reachability only — do not select a schema, so this passes before db:init has run.
      ssl: sslConfig(),
      connectTimeout: 10000,
    });
    const [rows] = await conn.query('SELECT VERSION() AS version');
    console.log(`DB: ok (${rows[0].version})`);
    return true;
  } catch (err) {
    const ip = await publicIp();
    console.error(`DB: FAILED [${err.code || 'ERR'}] ${redact(err.message)}`);
    console.error(`    -> your current public IP is ${ip}; ensure the RDS security group allows TCP ` +
      `${process.env.DB_PORT || 3306} from it and the instance is publicly accessible.`);
    console.error('    -> if the TLS handshake fails, fetch AWS global-bundle.pem and pass it as ' +
      'ssl.ca — never rejectUnauthorized:false.');
    return false;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

async function checkSmtp() {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.verify();
    console.log('SMTP: ok');
    return true;
  } catch (err) {
    console.error(`SMTP: FAILED [${err.code || err.responseCode || 'ERR'}] ${redact(err.message)}`);
    console.error('    -> confirm 2FA is enabled on the Gmail account and SMTP_PASS is a 16-char ' +
      'app password, not the account password.');
    return false;
  }
}

async function main() {
  const dbOk = await checkDb();
  const smtpOk = await checkSmtp();
  if (!dbOk || !smtpOk) {
    process.exitCode = 1;
    return;
  }
  console.log('preflight: all checks passed');
}

main();
