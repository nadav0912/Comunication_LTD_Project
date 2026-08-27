'use strict';

// Idempotent schema initialiser (SPEC.md §4, §6). Creates $DB_NAME if missing, then applies
// db/schema.sql. Runs standalone via `npm run db:init`; live run is deferred to Checkpoint C′.
//
// schema.sql is the spec's verbatim DDL (no IF NOT EXISTS); idempotency is added HERE by injecting
// IF NOT EXISTS into each CREATE TABLE, so a second run is a no-op instead of ER_TABLE_EXISTS_ERROR.
// It never drops or truncates — the database also holds demo data (SPEC §3).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { sslConfig } = require('../db/ssl');

const DB_PASSWORD = process.env.DB_PASSWORD;

function redact(text) {
  const out = String(text);
  return DB_PASSWORD ? out.split(DB_PASSWORD).join('***') : out;
}

function loadStatements() {
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const raw = fs.readFileSync(schemaPath, 'utf8').replace(/\r\n/g, '\n'); // R9: normalise CRLF first
  // Strip line + inline `--` comments before splitting, so each statement begins with CREATE TABLE
  // and the IF NOT EXISTS injection lands (the schema has no `--` inside any string literal).
  const withoutComments = raw
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS '));
}

async function main() {
  const dbName = process.env.DB_NAME;
  if (!dbName) throw new Error('DB_NAME is not set — copy .env.example to .env first');

  // Connect WITHOUT selecting a schema so a missing database can be created.
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: DB_PASSWORD,
    ssl: sslConfig(),
    multipleStatements: false,
  });

  try {
    // dbName is an operator-supplied identifier from .env, not request input; backtick-quote it.
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4`);
    await conn.query(`USE \`${dbName}\``);

    const statements = loadStatements();
    for (const stmt of statements) {
      await conn.query(stmt);
    }
    console.log(`db:init ok — ${statements.length} statements applied to \`${dbName}\``);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(`db:init FAILED [${err.code || 'ERR'}] ${redact(err.message)}`);
  process.exitCode = 1;
});
