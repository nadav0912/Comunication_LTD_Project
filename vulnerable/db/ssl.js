'use strict';

// Shared TLS config for every RDS connection (SPEC.md §3). rejectUnauthorized stays TRUE.
//
// AWS RDS server certificates are signed by Amazon RDS CAs that are NOT in Node's default trust
// store, so the handshake fails with "self-signed certificate in certificate chain" unless we
// supply the CA. We ship AWS's public global bundle (db/global-bundle.pem) and pass it as ssl.ca.
// DB_SSL_CA overrides the path if needed. NEVER set rejectUnauthorized:false (SPEC §3, §13 Never).

const fs = require('fs');
const path = require('path');

function sslConfig() {
  if (process.env.DB_SSL !== 'true') return undefined;
  const config = { rejectUnauthorized: true };
  const caPath = process.env.DB_SSL_CA || path.join(__dirname, 'global-bundle.pem');
  if (fs.existsSync(caPath)) {
    config.ca = fs.readFileSync(caPath);
  }
  return config;
}

module.exports = { sslConfig };
