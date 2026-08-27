# Spec: Comunication_LTD Secure Information System

> Derived from `Comunication_LTD_Spec.md` (the course brief). Where this document is more
> specific than the brief, this document governs implementation. Where the two conflict on a
> *requirement*, the brief wins and the conflict is recorded in **Deliberate Deviations** (§14).

---

## 1. Objective

Build a web-based information system for a fictional ISP that lets an authenticated **employee**
log in, manage their own credentials, and register **customers** (data records — customers never
log in). Ship it **twice**: an intentionally **vulnerable** build and a **secure** build, so that
Stored XSS and SQL Injection can be demonstrated succeeding in one and failing in the other.

**User:** a single account type — the employee/user. "Administrator" is only the person who edits
`config.json` on the server; there is no in-app admin role and no admin screen.

**Success looks like:** both builds run standalone, every screen in §5 of the brief works, the two
attacks are reproducible with screenshots against `vulnerable/`, the identical payloads are inert
against `secure/`, and the password policy changes behaviour when `config.json` is edited with no
code change.

### User stories

| # | As an employee I want to… | So that… | Brief |
|---|---|---|---|
| U1 | register with username, email and a policy-compliant password | I have an account | §5.1 |
| U2 | log in and be told when my credentials are wrong | I can reach the system screen | §5.3 |
| U3 | be locked out after 3 consecutive failures | brute force is stopped | §5.3 |
| U4 | change my password using my current one | I can rotate credentials | §5.2 |
| U5 | be refused if I reuse one of my last 3 passwords | old credentials stay dead | §5.2 |
| U6 | receive an emailed reset value when I forget my password | I can recover access | §5.5 |
| U7 | add a customer and see the name I just entered rendered back | I can confirm the record | §5.4 |
| A1 | (as administrator) edit `config.json` and change policy behaviour | policy is not hard-coded | §4 |

---

## 2. Tech Stack

| Layer | Choice | Version / notes |
|---|---|---|
| Runtime | Node.js | v22.x (verified: v22.17.1) — uses built-in `--test`, `--watch`, `--env-file` |
| Server | Express | ^4.19 — JSON API only, no template engine |
| Session | express-session | ^1.18 — `MemoryStore`, single process |
| Database | MySQL 8.x on **AWS RDS** | driver `mysql2` ^3.11, TLS required |
| Mail | nodemailer | ^6.9 — real Gmail SMTP with an app password |
| Env | dotenv | ^16 (or `node --env-file`) |
| Client | Static HTML + Bootstrap 5 (CDN) + vanilla JS `fetch()` | no bundler, no build step, no TypeScript |
| Crypto | Node built-in `crypto` | `createHmac('sha256', salt)` for passwords; `createHash('sha1')` for reset tokens |
| Test | `node:test` + `supertest` ^7 | security-critical paths only |
| Lint | eslint ^9 (flat config) | optional — see Open Questions |

**Architecture.** Express serves `public/` statically and mounts a JSON API under `/api/*`.
Client JS calls the API with `fetch(url, { credentials: 'same-origin' })` and writes results into
the DOM itself. There is no server-side templating, so **output encoding is entirely the client's
job** — which is exactly what the XSS demo turns on (`innerHTML` = vulnerable,
`textContent` = secure).

**Client-side validation is a convenience only.** Every security decision — password policy,
history, lockout, token validity — is enforced on the server, because client JS is trivially
bypassed with `curl`. The test suite proves this by calling the API directly.

---

## 3. Deployment Topology

Two independent applications, two ports, **two databases on the same RDS instance**:

| Build | Directory | Port | Database |
|---|---|---|---|
| Secure | `secure/` | 3000 | `comm_ltd_secure` |
| Vulnerable | `vulnerable/` | 3001 | `comm_ltd_vulnerable` |

Separate schemas are **not optional**: a successful SQLi demo can drop, alter or leak rows, and
must not be able to corrupt the secure build's data or the marker's demo.

**Tests share their own tree's database — there is no third schema.** Because a test run must not
destroy the demo data sitting in `comm_ltd_secure`, no suite may `TRUNCATE`. Every fixture is
created with a `__test_` prefix on `username` / `customers.name`, and each suite deletes only its
own rows in an `after()` hook (§12). A crashed run leaves prefixed rows behind, which are harmless
and removable with `npm run db:clean-tests`.

**RDS prerequisites**

- Security group inbound rule allowing TCP 3306 from the developer's public IP.
- TLS enforced: `mysql2` config uses `ssl: { rejectUnauthorized: true }`. If the handshake fails,
  download the AWS `global-bundle.pem` and pass it as `ssl: { ca }` — never `rejectUnauthorized: false`.
- The RDS master user is used for development only; it is never committed.

---

## 4. Commands

Run from inside `secure/` or `vulnerable/` — both trees expose the identical script names.

```
npm install                 # install dependencies
npm run db:init             # create schema + tables from db/schema.sql against $DB_NAME
npm run db:seed             # optional: one demo user + a few customers
npm run db:clean-tests      # delete leftover `__test_%` rows from a crashed run
npm run preflight           # verify RDS TLS + Gmail SMTP reachability (run jointly — see §15)
npm start                   # node server.js
npm run dev                 # node --watch server.js
npm test                    # node --test --test-concurrency=1 --env-file=.env.test tests/
npm run lint                # npx eslint .
npm run lint:fix            # npx eslint . --fix
```

Root-level convenience (from the repository root):

```
npm --prefix secure start        # secure build on :3000
npm --prefix vulnerable start    # vulnerable build on :3001
npm --prefix secure test         # secure regression suite (attacks must FAIL)
npm --prefix vulnerable test     # attack evidence suite (attacks must SUCCEED)
```

### Environment (`.env`, never committed — ship `.env.example`)

```
PORT=3000
SESSION_SECRET=<32+ random bytes, hex>

DB_HOST=<instance>.<region>.rds.amazonaws.com
DB_PORT=3306
DB_USER=admin
DB_PASSWORD=<rds password>
DB_NAME=comm_ltd_secure
DB_SSL=true

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=you@gmail.com
SMTP_PASS=<16-char Google app password, NOT the account password>
MAIL_FROM=Comunication_LTD <you@gmail.com>

RESET_TOKEN_TTL_MINUTES=15
```

`.env.test` is identical to the tree's own `.env` but with `PORT=0` (ephemeral port for supertest).
It points at the **same** database as the tree it lives in — see §3 for why there is no separate
test schema and how suites avoid destroying demo data.

---

## 5. Project Structure

```
Comunication_LTD_Project/
├── Comunication_LTD_Spec.md      # original course brief (source of truth for requirements)
├── SPEC.md                       # this document
├── README.md                     # setup, how to run both builds, demo walkthrough
├── docs/
│   ├── attack-report.md          # deliverable §7.1/§7.5 — each attack, impact, fix
│   └── screenshots/              # evidence: payload entered, payload firing, payload inert
│
├── secure/                       # ── full app, fixed code paths ──
│   ├── package.json
│   ├── .env.example
│   ├── config.json               # password policy — admin-editable, NOT hard-coded
│   ├── server.js                 # express app, static + session + /api mounts
│   ├── db/
│   │   ├── connection.js         # mysql2 pool, TLS
│   │   └── schema.sql            # users, password_history, customers
│   ├── scripts/
│   │   ├── init-db.js            # runs schema.sql
│   │   └── seed.js
│   ├── routes/                   # JSON only — never returns HTML
│   │   ├── auth.js               # POST /api/register, /api/login, /api/logout       (5.1, 5.3)
│   │   ├── password.js           # POST /api/change-password, /api/forgot, /api/reset (5.2, 5.5)
│   │   └── customers.js          # POST /api/customers, GET /api/customers           (5.4)
│   ├── services/
│   │   ├── passwordPolicy.js     # loads config.json; length/complexity/dictionary/history
│   │   ├── crypto.js             # HMAC+salt, SHA-1 reset token
│   │   └── mailer.js             # nodemailer transport
│   ├── middleware/
│   │   └── requireAuth.js        # 401 unless req.session.userId
│   ├── data/
│   │   └── common-passwords.txt  # dictionary list for blockDictionaryWords
│   ├── public/
│   │   ├── index.html            # login — title "Comunication_LTD Information System"
│   │   ├── register.html
│   │   ├── change-password.html
│   │   ├── forgot-password.html
│   │   ├── reset-password.html
│   │   ├── system.html           # add customer + display entered name
│   │   ├── css/style.css
│   │   └── js/
│   │       ├── api.js            # fetch wrappers: JSON, credentials, error surfacing
│   │       ├── register.js  login.js  change-password.js
│   │       ├── forgot-password.js  reset-password.js
│   │       └── system.js         # ← the XSS sink lives here
│   └── tests/
│       ├── password-policy.test.js
│       ├── crypto.test.js
│       ├── auth.test.js          # register, login, lockout
│       ├── password-history.test.js
│       ├── reset-flow.test.js
│       └── attacks.test.js       # SQLi + stored XSS must FAIL here
│
└── vulnerable/                   # ── structurally identical tree, vulnerable code paths ──
    └── … same layout …
        └── tests/attacks.test.js # SQLi + stored XSS must SUCCEED here (this is the evidence)
```

### Where the two trees differ — and nowhere else

| Concern | File(s) | Vulnerable | Secure |
|---|---|---|---|
| SQL Injection | `routes/auth.js`, `routes/password.js`, `routes/customers.js` | string-concatenated SQL via `pool.query()` | `pool.execute(sql, params)` — parameterized |
| Stored XSS | `public/js/system.js` | `el.innerHTML = customer.name` | `el.textContent = customer.name` |
| Config | `.env` (`PORT`, `DB_NAME`) | 3001 / `comm_ltd_vulnerable` | 3000 / `comm_ltd_secure` |

Any other divergence between the trees is a bug. Non-security changes must be applied to both.

---

## 6. Database Schema (`db/schema.sql`)

```sql
CREATE TABLE users (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  username              VARCHAR(50)  NOT NULL UNIQUE,
  email                 VARCHAR(255) NOT NULL,
  password_hash         CHAR(64)     NOT NULL,          -- HMAC-SHA256 hex
  salt                  CHAR(32)     NOT NULL,          -- 16 random bytes, hex
  failed_login_attempts INT          NOT NULL DEFAULT 0,
  is_locked             TINYINT(1)   NOT NULL DEFAULT 0,
  reset_token           CHAR(40)     NULL,              -- SHA-1 hex
  reset_token_expires   DATETIME     NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE password_history (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT      NOT NULL,
  password_hash CHAR(64) NOT NULL,                       -- HMAC-SHA256 hex
  salt          CHAR(32) NOT NULL,                       -- the salt THIS hash was computed with
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ph_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_ph_user_created (user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE customers (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,        -- ← the Stored XSS carrier
  email      VARCHAR(255) NULL,
  phone      VARCHAR(30)  NULL,
  sector     VARCHAR(50)  NULL,
  package    VARCHAR(50)  NULL,
  created_by INT          NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cust_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`customers.name` is `VARCHAR(255)` and stores **whatever was typed, verbatim**, in both builds.
Escaping is an *output* concern, not a storage concern — sanitising on input would delete the
stored-XSS demo and is the wrong fix to teach.

**Password history semantics.** `password_history` carries a `salt` column beyond what the brief's
§3 table lists, and the salt is **rotated on every password change**. Two consequences follow, and
both are deliberate:

1. *Verification is per-row.* To test a candidate against history, recompute
   `HMAC(candidate, row.salt)` for each of the last `historyCount` rows and compare against that
   row's own `password_hash`. There is no single salt that can verify the whole history.
2. *A stolen database reveals less.* With one frozen salt per account, two identical historical
   hashes would prove the user reused a password; with a fresh salt per change, they do not, and
   each stored hash carries independent entropy.

**One row per password, written when it becomes active.** Registration inserts the first row;
each successful change or reset inserts the **new** credential's `(hash, salt)`. The current
password is therefore always the newest history row, and the reuse check is simply "the last
`historyCount` rows" with no special case for the credential currently in force. Rows beyond
`historyCount` are trimmed after each write.

**Lockout semantics.** `failed_login_attempts` increments on each failed password check and resets
to 0 on success. When it reaches `config.maxLoginAttempts`, `is_locked` is set to 1 and every
subsequent login attempt is refused regardless of credentials. The lock is cleared **only** by a
successful password reset via the forgot-password flow (§9.5) — which makes U3 and U6 demo as one
continuous story.

---

## 7. Password Policy Config (`config.json`)

Read by `services/passwordPolicy.js` and enforced entirely server-side. Editing this file must
change behaviour with **no code edit** — the file is re-read (cached by mtime) on each validation
call, so a change takes effect without restarting the server.

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

| Key | Enforced where | Rule |
|---|---|---|
| `passwordLength` | register, change, reset | minimum length, `>=` |
| `complexity.*` | register, change, reset | at least one char from each enabled class; specials = ``!@#$%^&*()-_=+[]{};:'",.<>/?\|`~`` |
| `historyCount` | change, reset | for each of the user's last N `password_history` rows, `HMAC(new, row.salt)` must not equal that row's `password_hash` (§6) |
| `blockDictionaryWords` | register, change, reset | reject if the lower-cased password appears in `data/common-passwords.txt`, or contains any listed word of length ≥ 4 |
| `maxLoginAttempts` | login | consecutive failures before `is_locked = 1` |

Validation returns **all** violations at once (`{ valid: false, errors: [...] }`) so the UI can list them.

---

## 8. API Contract

All endpoints accept and return JSON. Errors are `{ error: string, details?: string[] }`.

| Method | Path | Auth | Body | Success | Brief |
|---|---|---|---|---|---|
| POST | `/api/register` | — | `{username, email, password}` | `201 {id, username}` | 5.1 |
| POST | `/api/login` | — | `{username, password}` | `200 {username}` + session cookie | 5.3 |
| POST | `/api/logout` | session | — | `204` | 5.3 |
| GET | `/api/me` | session | — | `200 {username}` / `401` | — |
| POST | `/api/change-password` | session | `{currentPassword, newPassword}` | `200 {ok:true}` | 5.2 |
| POST | `/api/forgot` | — | `{email}` | `200 {ok:true}` | 5.5 |
| POST | `/api/reset` | — | `{token, newPassword}` | `200 {ok:true}` | 5.5 |
| POST | `/api/customers` | session | `{name, email?, phone?, sector?, package?}` | `201 {id, name, …}` | 5.4 |
| GET | `/api/customers` | session | — | `200 [{id, name, …}]` | 5.4 |

Status codes: `400` validation, `401` unauthenticated, `403` locked account, `409` duplicate
username, `500` unexpected. Unexpected errors log the stack server-side and return a generic
message — **stack traces and raw SQL errors are never sent to the client in the secure build**.

---

## 9. Functional Requirements

### 9.1 Register (brief §5.1)
Fields: username, email, password. Server validates policy → generates
`salt = randomBytes(16).hex` → `password_hash = HMAC-SHA256(password, salt)` → inserts the user →
inserts the same `(password_hash, salt)` pair as the first `password_history` row (§6).
Plaintext is never stored, never logged.

### 9.2 Change Password (brief §5.2)
Fields: current, new. Recompute the HMAC of `current` with the user's stored salt and compare with
`crypto.timingSafeEqual`. Validate `new` against policy. Then check reuse: for each of the last
`historyCount` rows of `password_history`, recompute `HMAC(new, row.salt)` and reject if it equals
that row's `password_hash` (§6 — the salt differs per row). On success: generate a **fresh** salt,
write `(new_hash, new_salt)` to `users`, insert the same pair as a new `password_history` row, and
trim rows beyond `historyCount`.

### 9.3 Login (brief §5.3)
Title: **"Comunication_LTD Information System"**. Fields: username, password.
Refuse immediately if `is_locked`. On a wrong password, increment `failed_login_attempts` and lock
at the configured threshold. On success, reset the counter to 0 and regenerate the session id.

### 9.4 System Screen — Add Customer (brief §5.4)
Authenticated only. Submit customer details → `POST /api/customers` → the response name is rendered
onto the page, and `GET /api/customers` re-renders the list on load. **This render is the XSS sink.**

### 9.5 Forgot Password (brief §5.5)
`POST /api/forgot` with an email → generate `randomBytes(20)` → `token = SHA1(raw).hex` (40 chars) →
store it in `users.reset_token` with `reset_token_expires = now + RESET_TOKEN_TTL_MINUTES` → email
the token to the user's address via Gmail SMTP. The user pastes the token into `reset-password.html`
together with a new password; the server checks the token matches and has not expired, applies
policy + history, writes a freshly-salted hash and its `password_history` row exactly as §9.2 does,
clears the token, and sets `is_locked = 0` and `failed_login_attempts = 0`.

---

## 10. Vulnerability Demonstrations (brief §6)

### 10.1 Stored XSS — `vulnerable/public/js/system.js`

- **Storage:** the payload is written to `customers.name` and persists in the database.
- **Sink:** `document.getElementById('lastCustomer').innerHTML = customer.name`.
- **Payload:** `<img src=x onerror="alert(document.cookie)">` — an event-handler payload, because a
  bare `<script>` injected via `innerHTML` does not execute.
- **Proof it is *stored*, not reflected:** log out, log back in, load `system.html` fresh — the
  payload fires again from `GET /api/customers` with no attacker interaction.
- **Fix (secure tree):** `el.textContent = customer.name`. The payload renders as visible inert text.

### 10.2 SQL Injection — `vulnerable/routes/*.js`

- **Vulnerable form:** `` pool.query(`SELECT * FROM users WHERE username = '${username}'`) ``.
- **Auth bypass payload:** username `' OR '1'='1' -- ` with any password.
- **Second location:** the customer search/insert path in `routes/customers.js`, demonstrating
  `' UNION SELECT id, username, password_hash, salt, … FROM users -- ` to leak the users table.
- **Fix (secure tree):** `pool.execute('SELECT … WHERE username = ?', [username])` — input is
  transmitted as a bound parameter and can never be parsed as SQL. `multipleStatements` stays
  `false` in the pool config for **both** builds.

### 10.3 Evidence

`docs/attack-report.md` documents, per vulnerability: the exact payload, the request, a screenshot
of it succeeding against `:3001`, a screenshot of it failing against `:3000`, the impact, and the
fix — plus the explicit note that client-side validation is not a security control.

---

## 11. Code Style

- CommonJS (`require`) throughout — matches the brief's plain-Node framing; no `"type": "module"`.
- 2-space indent, semicolons, single quotes, `const` by default.
- `camelCase` for JS identifiers, `snake_case` for SQL columns; map at the query boundary.
- `async/await` only — no `.then()` chains, no callbacks.
- Every route handler is wrapped so a rejected promise reaches the error middleware.
- Files stay small: a route module owns its endpoints and nothing else; all crypto lives in
  `services/crypto.js`; all policy lives in `services/passwordPolicy.js`.
- Comments explain *why*, not *what*. Both vulnerable code paths carry a
  `// !! INTENTIONALLY VULNERABLE — see SPEC.md §10 !!` banner so nothing is mistaken for an accident.

**Reference snippet — the secure form (`secure/routes/auth.js`):**

```js
const express = require('express');
const pool = require('../db/connection');
const { verifyPassword } = require('../services/crypto');
const { policy } = require('../services/passwordPolicy');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    // Parameterized: the driver sends `username` as a bound value, never as SQL text.
    const [rows] = await pool.execute(
      'SELECT id, password_hash, salt, failed_login_attempts, is_locked FROM users WHERE username = ?',
      [username]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'User does not exist.' }); // see Deviation D1
    if (user.is_locked) {
      return res.status(403).json({ error: 'Account locked. Use "Forgot password" to unlock.' });
    }

    if (!verifyPassword(password, user.salt, user.password_hash)) {
      const attempts = user.failed_login_attempts + 1;
      const locked = attempts >= policy().maxLoginAttempts ? 1 : 0;
      await pool.execute(
        'UPDATE users SET failed_login_attempts = ?, is_locked = ? WHERE id = ?',
        [attempts, locked, user.id]
      );
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    await pool.execute('UPDATE users SET failed_login_attempts = 0 WHERE id = ?', [user.id]);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      res.json({ username });
    });
  } catch (err) {
    next(err);
  }
});
```

**Reference snippet — the vulnerable counterpart (`vulnerable/routes/auth.js`):**

```js
// !! INTENTIONALLY VULNERABLE — see SPEC.md §10.2 !!
// Input is concatenated into the SQL text, so `' OR '1'='1' -- ` rewrites the WHERE clause.
const sql = `SELECT id, password_hash, salt, failed_login_attempts, is_locked
             FROM users WHERE username = '${username}'`;
const [rows] = await pool.query(sql);
```

**Reference snippet — the two render sinks (`public/js/system.js`):**

```js
// secure/  — payload is displayed as text, never parsed as markup
document.getElementById('lastCustomer').textContent = customer.name;

// vulnerable/  — !! INTENTIONALLY VULNERABLE — see SPEC.md §10.1 !!
document.getElementById('lastCustomer').innerHTML = customer.name;
```

---

## 12. Testing Strategy

**Framework:** Node's built-in runner (`node:test` + `node:assert/strict`) with `supertest` for HTTP.
No Jest, no Playwright, no test-runner dependency beyond `supertest`.

**Location:** `<tree>/tests/*.test.js`, mirroring the module under test.

**Database:** each tree's own database, loaded via `--env-file=.env.test` (§3 — there is no separate
test schema). Because the secure database also holds the demo data, **no suite may `TRUNCATE`**.
Instead:

- every fixture is created with a `__test_` prefix on `username` and `customers.name`, plus a
  per-run random suffix so two runs never collide;
- each suite deletes only its own rows in an `after()` hook;
- suites run serially (`--test-concurrency=1`) — parallel files against one remote database
  interfere and add latency-driven flakiness;
- `npm run db:clean-tests` removes `__test_%` leftovers from a crashed run.

A test that depends on the database being empty is a broken test — assertions scope themselves to
the fixtures they created.

**Coverage expectation:** not a percentage. The bar is that **every security control in §7 and §9
has at least one passing case and one rejecting case**, and every attack in §10 has a test in both
trees asserting opposite outcomes.

| Level | What it covers | Files |
|---|---|---|
| Unit | policy validation matrix, HMAC determinism + salt uniqueness, SHA-1 token shape | `password-policy.test.js`, `crypto.test.js` |
| API (supertest) | register→login→change→reset happy paths; lockout at N; history rejection; expired token | `auth.test.js`, `password-history.test.js`, `reset-flow.test.js` |
| Security regression | the §10 payloads sent as raw HTTP | `attacks.test.js` in **both** trees |
| Manual | the browser half of the XSS demo (the alert firing), screenshotted | `docs/attack-report.md` |

**The asymmetric suite — this is the deliverable's evidence:**

```js
// secure/tests/attacks.test.js
test('SQLi auth bypass is refused', async () => {
  const res = await request(app).post('/api/login')
    .send({ username: "' OR '1'='1' -- ", password: 'anything' });
  assert.equal(res.status, 401);
});

test('stored XSS payload survives storage but is returned as data, not markup', async () => {
  const payload = '<img src=x onerror="alert(1)">';
  await agent.post('/api/customers').send({ name: payload }).expect(201);
  const res = await agent.get('/api/customers');
  assert.equal(res.body[0].name, payload);   // stored verbatim — escaping is the client's job
});
```

```js
// vulnerable/tests/attacks.test.js
test('SQLi auth bypass SUCCEEDS (this is the vulnerability being demonstrated)', async () => {
  const res = await request(app).post('/api/login')
    .send({ username: "' OR '1'='1' -- ", password: 'anything' });
  assert.equal(res.status, 200);
});
```

A red `vulnerable/tests/attacks.test.js` means the vulnerability was accidentally fixed — which is a
failure of the deliverable, not a success.

**Policy-is-not-hard-coded test:** one test rewrites a temporary `config.json` with
`passwordLength: 14`, re-runs validation, and asserts that a 12-character password now fails —
proving requirement A1 without a server restart.

---

## 13. Boundaries

**Always**
- Enforce every security decision server-side; treat client validation as UX only.
- Use `pool.execute(sql, params)` in `secure/` — no exceptions, no "just this one internal value".
- Render untrusted strings with `textContent` in `secure/`.
- Keep the two trees structurally identical; apply non-security changes to both in the same commit.
- Run `npm test` in both trees before committing.
- Read the password policy from `config.json` at validation time — never inline a constant.
- Mark every intentional flaw with the `// !! INTENTIONALLY VULNERABLE !!` banner and a §10 reference.
- Keep `multipleStatements: false` and TLS on in both `db/connection.js` files.

**Ask first**
- Changing the database schema after `db:init` has been run.
- Adding any npm dependency beyond the §2 list.
- Changing the shape of an API response in §8 (the client JS and the tests both depend on it).
- Adding a vulnerability beyond the two the brief requires (§6).
- Anything that alters the submission layout in §5.

**Never**
- Commit `.env`, the RDS password, or the Gmail app password. `.env.example` only.
- Point the vulnerable build at `comm_ltd_secure`.
- Store or log a password in plaintext, including in error messages and request logs.
- Sanitise `customers.name` on input — that would delete the demo and teaches the wrong fix.
- Use `rejectUnauthorized: false` to make the RDS TLS handshake pass.
- Copy vulnerable code into `secure/`, or fix a vulnerability in `vulnerable/`.
- Weaken or delete a failing security test to make the suite green.

---

## 14. Deliberate Deviations from Secure Practice

The brief mandates several things a production system should not do. They are implemented as
specified and documented here so they read as informed choices, not oversights. Each is repeated in
`docs/attack-report.md`.

| # | What the brief requires | Why it is weak | Why we do it anyway |
|---|---|---|---|
| D1 | §5.3 "check whether the user exists and return an appropriate message" | Enables **username enumeration** — an attacker can harvest valid accounts | Explicit course requirement; noted in the report with the safe alternative ("Invalid username or password") |
| D2 | §2/§5.1 HMAC-SHA256 + salt for password storage | HMAC is *fast*; a stolen database is brute-forceable. bcrypt/scrypt/Argon2 are the correct choice | Explicit course requirement — the brief names `hmac` |
| D3 | §5.5 the SHA-1 value that is emailed is the same value stored in `reset_token` | A database read yields working reset tokens; SHA-1 is also broken for collision resistance | Explicit course requirement; the safe form (store `hash(token)`, email the raw token) is described in the report |
| D4 | Permanent lock after N failures | Enables a trivial **denial of service** against a known username | Brief §5.3 says "lock the account"; mitigated by making forgot-password the unlock path |

No CSRF protection is specified by the brief. Session cookies are set `httpOnly`, `sameSite: 'lax'`
(which blunts cross-site POSTs) and `secure` when served over TLS; a CSRF token is listed as an
optional extension in Open Questions rather than assumed.

---

## 15. Build Order

Dependency-ordered; each step is verifiable before the next begins.

| # | Module | Delivers | Depends on | Verified by |
|---|---|---|---|---|
| 1 | `platform` | `server.js`, `db/connection.js`, `db/schema.sql`, `scripts/init-db.js`, session, error middleware | — | `npm run db:init` creates 3 tables; `GET /` serves the login page |
| 2 | `password-policy` | `config.json`, `services/passwordPolicy.js`, `data/common-passwords.txt` | 1 | `password-policy.test.js` incl. the A1 config-change test |
| 3 | `crypto` | `services/crypto.js` — HMAC+salt, SHA-1 token, timing-safe compare | — | `crypto.test.js` |
| 4 | `auth` | register, login, logout, lockout, `requireAuth`, `index.html`, `register.html` | 1,2,3 | `auth.test.js`; U1–U3 by hand |
| 5 | `customers` | `POST/GET /api/customers`, `system.html`, `system.js` | 4 | U7 by hand; list survives re-login |
| 6 | `password-change` | change-password endpoint + history, `change-password.html` | 4 | `password-history.test.js`; U4, U5 |
| 7 | `password-reset` | `services/mailer.js`, forgot/reset endpoints, both HTML pages, lock clearing | 4,6 | a real email is received; `reset-flow.test.js`; U6 |
| 8 | `vulnerable-build` | copy `secure/` → `vulnerable/`, revert the 3 SQL modules + `system.js`, second DB, port 3001 | 1–7 | `vulnerable/tests/attacks.test.js` green (attacks succeed) |
| 9 | `evidence` | `docs/attack-report.md` + screenshots, `README.md` | 8 | both attacks screenshotted succeeding on :3001 and failing on :3000 |

Steps 5 and 6 are independent of each other and can be built in either order. Everything else is
strictly sequential. **Step 8 comes after a fully working secure build** — inverting the brief's §8
ordering, because deriving the vulnerable tree by reverting two known code paths is far less
error-prone than fixing a vulnerable tree and hoping nothing was missed.

**Live-connection verification is a joint session, not a solo step.** RDS reachability (security
group, public accessibility, TLS handshake) and Gmail SMTP are verified together with the developer
via `npm run preflight`, not by the agent alone, and this happens **after** the code is written
rather than before it. The trade-off is accepted knowingly: every "Verified by" cell above that
needs a live database or a real email is deferred to that session, so tasks reach *code complete,
verification pending* until then. `tasks/plan.md` risks R1–R2 record what that defers.

---

## 16. Success Criteria

Testable conditions. The project is done when all of these hold.

**Functional**
1. `npm --prefix secure start` and `npm --prefix vulnerable start` both boot and serve their login page.
2. A new user can register, log in, add a customer, see the name rendered, change their password, and reset it by email — end to end, in a browser.
3. The login title reads exactly "Comunication_LTD Information System".
4. Three consecutive wrong passwords lock the account; a 4th attempt with the *correct* password is still refused; a successful reset unlocks it.
5. Reusing any of the last 3 passwords in change-password is rejected with a clear message.
6. A real reset email arrives at a real inbox containing a 40-character hex value that works once and expires after `RESET_TOKEN_TTL_MINUTES`.

**Configuration (A1)**

7. Setting `passwordLength` to 14 in `config.json` makes a 12-character password fail registration, with no code change and no server restart.
8. Setting `maxLoginAttempts` to 5 changes the lockout threshold to 5.

**Security — vulnerable build**

9. `' OR '1'='1' -- ` as the username logs in on `:3001` without a valid password.
10. A customer named `<img src=x onerror="alert(document.cookie)">` fires an alert on `:3001` — including on a fresh page load after re-login, proving it is *stored*.
11. A UNION-based payload returns rows from `users` on `:3001`.

**Security — secure build**

12. Payloads 9–11 all fail on `:3000`: the SQLi attempts return 401/400 with no data leaked, and the XSS payload is displayed as literal text.
13. No stack trace, SQL error text, or hash/salt value appears in any secure-build API response.
14. `git grep -n '\${' secure/routes/` returns no interpolation inside a SQL string.

**Process**

15. `npm test` passes in `secure/`; `npm test` passes in `vulnerable/` (where "passes" means the attacks succeeded).
16. `docs/attack-report.md` documents both vulnerabilities with payload, impact, fix, screenshots, and the client-side-validation note.
17. `git ls-files` shows no `.env`; `.env.example` is present in both trees.

---

## 17. Open Questions

1. **ESLint** — included in §2 as a devDependency with a minimal flat config. Drop it if you want zero tooling beyond the runtime; say so and I'll remove the lint scripts.
2. **CSRF token** — not required by the brief (§14). Add it to the secure build as an extra-credit talking point, or leave it out and mention it as future work in the report?
3. **RDS credentials** — needed for the joint preflight session (§15), not for writing code. Should `scripts/init-db.js` issue `CREATE DATABASE IF NOT EXISTS` for `comm_ltd_secure` / `comm_ltd_vulnerable`, or do they already exist on the instance? **Assumed:** `init-db.js` creates them.
4. **Gmail app password** — needs to be generated (2FA must be enabled on the account) before the reset flow can be verified end to end. Confirm which address will send *and* receive during the demo.
5. **Dictionary list** — `data/common-passwords.txt` will ship with roughly the top 1,000 common passwords. Larger list, or is 1,000 enough for the demo?
6. **Customer fields** — the brief leaves these open; I've chosen name, email, phone, sector, package. Add anything the course requires (e.g. a fixed package dropdown from a lookup table)?
7. **Report language** — is `docs/attack-report.md` submitted in English or Hebrew?

---

## 18. As-Built Decisions & Open-Question Resolutions

Recorded during implementation (the spec is the living contract). Where this section differs from
earlier text above, **this section is what was built**.

**Database names.** The instance uses `secure_app_db` (secure) and `vulnerable_app_db` (vulnerable),
not `comm_ltd_secure` / `comm_ltd_vulnerable`. The two-schema separation of §3 is unchanged; only the
names differ. The code reads `process.env.DB_NAME`, so nothing is hard-coded.

**RDS TLS.** AWS RDS server certs are not in Node's default trust store, so the pool loads AWS's
public `db/global-bundle.pem` as `ssl.ca` (auto-detected; `DB_SSL_CA` overrides). `rejectUnauthorized`
stays `true` — never disabled.

**Customer search endpoint (added).** `GET /api/customers?search=<term>` (name filter) was added
beyond §8. §10.2 requires a UNION demo on the customer path, which needs an injectable `SELECT`;
the list endpoint took no input. Secure binds the term; the vulnerable twin concatenates it.

**Vulnerable login is two queries.** Passwords are verified in application code with a per-user salt,
so a single `WHERE username='…'` injection could not bypass the password check. The vulnerable build
therefore performs the credential check as a **second concatenated query** (`username` +
`password_hash`), which `' OR '1'='1' -- ` comments out — making SC9 hold while normal logins and
lockout still work. (The secure build verifies in app code with `timingSafeEqual`, unchanged.)

**Password-history reuse window.** Per §6, the window is the last `historyCount` `password_history`
rows **including the current password**; a password that has fallen out of that window is reusable.

**Test command.** `npm test` runs `node --test … tests/*.test.js` (a glob) — the bare `tests/`
directory argument is mis-handled as a module path on Node 22 / Windows.

**Open questions resolved:**
1. **ESLint** — kept (minimal ESLint 9 flat config; `npm run lint` clean).
2. **CSRF** — omitted (not required by the brief); noted as future work in the attack report.
3. **RDS databases** — `init-db.js` issues `CREATE DATABASE IF NOT EXISTS` and created both.
4. **Gmail** — configured and verified; a real reset email was delivered end to end (SC6).
5. **Dictionary** — ships ~250 common passwords/words; sufficient for the demo (expandable).
6. **Customer fields** — name, email, phone, sector, package; sector/package are dropdowns.
7. **Report language** — English (`docs/attack-report.md`).

**Deferred:** `nodemailer` is pinned to `^6.9` per §2 despite a high-severity npm advisory whose only
fix is a breaking v9 upgrade — out of scope for the taught SQLi/XSS demo. The seven attack screenshots
in `docs/screenshots/` are a manual browser capture step (guide in that directory).
