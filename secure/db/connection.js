'use strict';

// Single mysql2 connection pool shared by every route (SPEC.md §2, §3).
//
// TLS is required and `rejectUnauthorized` stays true — if the RDS handshake fails, fetch AWS's
// global-bundle.pem and pass it as `ssl.ca` (set DB_SSL_CA to its path). NEVER set
// rejectUnauthorized:false (SPEC §3, §13 Never).
//
// `multipleStatements` stays false in BOTH builds (SPEC §13): the vulnerable build's SQLi demo
// relies on `OR '1'='1'` and UNION, never on stacked statements, so there is no reason to enable it.

const fs = require('fs');
const mysql = require('mysql2/promise');

function sslConfig() {
  if (process.env.DB_SSL !== 'true') return undefined;
  const config = { rejectUnauthorized: true };
  if (process.env.DB_SSL_CA) {
    config.ca = fs.readFileSync(process.env.DB_SSL_CA);
  }
  return config;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: sslConfig(),
  multipleStatements: false,
  connectionLimit: 5,
  waitForConnections: true,
  charset: 'utf8mb4',
});

module.exports = pool;
