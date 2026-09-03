# Comunication_LTD — Secure Information System

## Submitters

1. Itzhak Mutzeri — ID: 326667334
2. Name — ID:
3. Name — ID:
4. Name — ID:
5. Name — ID:

A small web system for a fictional ISP. An employee logs in, manages their own
password, and registers customers. It comes in two versions: a vulnerable one and
a secure one, so you can see the same Stored XSS and SQL Injection attacks work on
the first and fail on the second.

- Attack write-up: [`docs/attack-report.md`](docs/attack-report.md)
- Attack how-to: [`docs/attack-howto.md`](docs/attack-howto.md)

| Build      | Directory     | Port | Database            |
| ---------- | ------------- | ---- | ------------------- |
| Secure     | `secure/`     | 3000 | `secure_app_db`     |
| Vulnerable | `vulnerable/` | 3001 | `vulnerable_app_db` |

The two trees are identical apart from five files: `routes/auth.js`,
`routes/password.js`, `routes/customers.js`, `public/js/system.js`, and
`.env.example`. Everything else is byte-for-byte the same.

## Prerequisites

- Node.js 22.x. Tested on 22.17.1.
- MySQL 8.x. This project runs against an AWS RDS instance over TLS, with two
  schemas on it: `secure_app_db` and `vulnerable_app_db`.
- A Gmail account with 2-Step Verification, used to send password-reset emails.

## Setup

### 1. Install

```
npm --prefix secure install
npm --prefix vulnerable install
```

### 2. Set up each build's `.env`

Copy the example and fill in real values. Don't commit `.env` — it's gitignored.

```
cp secure/.env.example      secure/.env
cp vulnerable/.env.example  vulnerable/.env
```

In each `.env`, set:

- `SESSION_SECRET` — 32+ random hex bytes. Generate one with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `DB_HOST`, `DB_PORT` (3306), `DB_USER`, `DB_PASSWORD` — your RDS credentials.
  Keep `DB_NAME` as shipped and leave `DB_SSL=true`.
- `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` — your Gmail address and a 16-character App
  Password (Google Account → Security → 2-Step Verification → App passwords). This
  is not your normal login password.

### 3. Let your machine reach RDS (one time)

- In the RDS security group, allow inbound TCP 3306 from your public IP.
- TLS is on. The trees ship AWS's CA bundle at `db/global-bundle.pem` and use it
  automatically; keep `ssl.rejectUnauthorized` set to `true`. If your IP changes,
  add the rule again. `npm run preflight` prints your current public IP if it fails.

### 4. Check the connection, then create the schema

```
npm --prefix secure     run preflight     # expect: DB: ok / SMTP: ok
npm --prefix vulnerable run preflight
npm --prefix secure     run db:init        # creates secure_app_db + tables
npm --prefix vulnerable run db:init        # creates vulnerable_app_db + tables
npm --prefix secure     run db:seed        # optional: demo login demo / Comm7#Ltdxyz + 3 customers
npm --prefix vulnerable run db:seed
```

## Running

```
npm --prefix secure     start     # http://localhost:3000
npm --prefix vulnerable start     # http://localhost:3001
```

Open each one in a browser. Both show the login page titled
"Comunication_LTD Information System".

### Walkthrough (works on either build)

1. Register at `/register.html`. A weak password shows the policy errors; a strong
   one goes through.
2. Log in at `/` to reach the System page.
3. Add a customer. The name is shown back to you and the list reloads each visit.
4. Change your password from the top-right. A recently used password is rejected.
5. Use Forgot password, get the token by email, then reset (which also unlocks the
   account).

### The two attacks

See [`docs/attack-report.md`](docs/attack-report.md) for the full walkthrough.

- Login bypass: log in as `' OR '1'='1'#` with any password. Works on :3001,
  refused on :3000.
- Data leak: paste
  `' UNION SELECT id, username, password_hash, salt, 1, 1, 1, NOW() FROM users#`
  into the customer Search box. Dumps the users table on :3001, nothing on :3000.
- Stored XSS: add a customer named `<img src=x onerror="alert(document.cookie)">`.
  The alert fires on :3001 (again after re-login, since it's stored) and shows as
  plain text on :3000.

## Password policy (`config.json`)

The policy is read from `config.json` on every check, so editing the file changes
behavior with no restart:

```json
{
  "passwordLength": 10,
  "complexity": {
    "requireUppercase": true,
    "requireLowercase": true,
    "requireDigits": true,
    "requireSpecialChars": true
  },
  "historyCount": 3,
  "blockDictionaryWords": true,
  "maxLoginAttempts": 3
}
```

## Notes

The attack evidence — payloads, impact, fixes, and screenshots — is in
[`docs/attack-report.md`](docs/attack-report.md).

The build includes four deviations from best practice that the course requires
(username enumeration, fast HMAC hashing, plaintext-equivalent reset tokens, and
permanent lockout). Each one is intentional and explained, along with its safer
alternative, in the attack report's Deviations section. Client-side validation is
only there for convenience; every security check is enforced on the server.
