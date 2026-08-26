# Task List: Comunication_LTD Secure Information System

Plan and rationale: [`tasks/plan.md`](plan.md). Spec: [`SPEC.md`](../SPEC.md).
Every task also clears the **Definition of Done** in `tasks/plan.md` before it is checked off.

Scope key: **XS** 1 file · **S** 1–2 · **M** 3–5. Nothing here is larger than M.

**⏳ = deferred verification.** Live RDS and Gmail are exercised jointly with the developer at
**Checkpoint C′**, not before (plan A2). Any verification step marked ⏳ is written now, run then.
A task carrying ⏳ items is *code complete, verification pending* — it is **not** checked off until
C′ clears it. Tests are still written alongside their code; they simply queue up unrun.

Unaffected and run continuously: `crypto.test.js`, `password-policy.test.js` (pure functions, no
database), ESLint, the SC14 static SQL check, and static page serving.

---

## Phase 0 — Foundation

### - [x] T1: Repo scaffolding + `preflight.js` — DONE (commit e743b2b)

**Description:** Create the `secure/` tree skeleton, `package.json`, `.env.example`, and
`scripts/preflight.js` — which opens a TLS connection to RDS and runs `SELECT 1`, then calls
nodemailer's `transporter.verify()` against Gmail. **The script is written here but not run**: live
connectivity is verified jointly with the developer at Checkpoint C′ (plan A2). Writing it now is
what makes that session one command instead of an afternoon of guessing.

**Acceptance criteria:**
- [x] `secure/package.json` declares express, express-session, mysql2, nodemailer, dotenv, and supertest (dev), matching §2 versions
- [x] `secure/.env.example` contains every key in §4 with placeholder values and no real secrets
- [x] `scripts/preflight.js` reports `DB: ok (<mysql version>)` / `SMTP: ok`, or fails with an actionable message naming the machine's current public IP (for the security-group rule) and the raw SMTP error code
- [x] `preflight.js` never prints `DB_PASSWORD` or `SMTP_PASS`, including inside a driver error object

**Verification:**
- [x] `npm --prefix secure install` succeeds (198 packages)
- [x] `node -c scripts/preflight.js` parses; the failure branches are read by eye
- [x] `git status` shows `.env` untracked and ignored; `.env.example` staged
- [x] ⏳→✅ `npm run preflight` DB half verified live: **DB: ok (MySQL 8.4.9)** after adding the RDS CA bundle (SPEC §3 TLS fallback). SMTP half still pending Gmail (T11).

**Dependencies:** None. Q1/Q2 are needed at C′, not here.
**Files:** `secure/package.json`, `secure/.env.example`, `secure/scripts/preflight.js`, `.gitignore`
**Scope:** M

---

### - [x] T2: Schema, connection pool, `db:init` — DONE (commit pending)

**Description:** Write `db/schema.sql` exactly as specified in §6 — **including the `salt CHAR(32)`
column on `password_history`** (plan A8) — a `mysql2` pool with TLS and `multipleStatements: false`,
and an idempotent `scripts/init-db.js` that creates the database if missing and applies the schema.
Statement splitting normalises `\r\n` first (risk R9). Since nothing here runs until C′, the schema
is reviewed against §6 column by column at Checkpoint A (risk R1b).

**Acceptance criteria:**
- [x] `db/schema.sql` matches §6 exactly: three tables, `password_history.salt`, both FKs, the `idx_ph_user_created` index, `utf8mb4`
- [x] `db:init` creates `users`, `password_history`, `customers` in `$DB_NAME`, and succeeds on a second run (idempotent) — `IF NOT EXISTS` injected at runtime; comment-strip verified to yield 3 CREATE statements
- [x] `db/connection.js` exports a pool with `ssl: { rejectUnauthorized: true }`, `multipleStatements: false`, `connectionLimit: 5`
- [x] A connection failure message contains no password — `init-db.js` redacts `DB_PASSWORD` from errors

**Verification:**
- [x] Line-by-line diff of `schema.sql` against SPEC §6 — written verbatim; splitter proven to emit `users`/`password_history`/`customers`
- [x] ⏳→✅ **Verified live against RDS** (`secure_app_db`): `db:init` twice both exit 0 (idempotent); `password_history.salt CHAR(32)` present; `users.is_locked TINYINT(1)`, `reset_token CHAR(40)` present; `idx_ph_user_created` present

**Dependencies:** T1
**Files:** `secure/db/schema.sql`, `secure/db/connection.js`, `secure/scripts/init-db.js`, `secure/package.json`
**Scope:** M

---

### - [x] T3: Express skeleton — static, session, error middleware — DONE (commit pending)

**Description:** `server.js` serving `public/` statically, `express.json()`, `express-session` with
`httpOnly` / `sameSite: 'lax'` / `secure` when behind TLS, an `/api` router mount point, a 404 JSON
handler for unknown `/api/*` paths, and a terminal error middleware that logs the stack server-side
and returns a generic `{ error }` (§8, SC13). A placeholder `public/index.html` proves static serving.

**Acceptance criteria:**
- [x] `npm start` boots on `$PORT` and `GET /` returns the placeholder page (curl: 200 text/html)
- [x] `GET /api/nope` returns `404` JSON, never HTML (curl: 404 application/json)
- [x] A route that throws returns `500 {"error":"..."}` with no stack, no SQL text, and the full stack printed to the server console (tests/server.test.js asserts no leak)
- [x] Session cookie is `HttpOnly` and `SameSite=Lax` (sessionOptions() unit-tested; runtime cookie exercised at T7 login)

**Verification:**
- [x] `node server.js` on :3005, then `curl` of `/` and `/api/nope` — both as expected
- [x] `node --test tests/server.test.js` — 4/4 pass
- [ ] Manual: browser devtools → Application → Cookies shows the flags (at T7)

**Dependencies:** T2
**Files:** `secure/server.js`, `secure/public/index.html`, `secure/middleware/errorHandler.js`
**Scope:** S

---

## ✅ Checkpoint A: Foundation (no live database yet — plan A2)

- [x] Server boots, serves a static page, returns JSON errors with no stack leakage
- [x] **`db/schema.sql` read against SPEC §6 column by column** — written verbatim; splitter proven to emit the three tables with the `salt` column, both FKs, and the index
- [x] **`db/connection.js` read against §3** — TLS `rejectUnauthorized:true` (optional CA), `multipleStatements: false`, `connectionLimit: 5`, no `rejectUnauthorized: false`
- [x] `preflight.js` exists and its failure branches are readable
- [x] `.env` is untracked; `.env.example` is committed
- [ ] **Review with human before proceeding** — last cheap moment to change the stack (reached; continuing with DB-free T4/T5 per `/build auto`)

---

## Phase 1 — Registration (U1, A1)

### - [x] T4: `services/crypto.js` — DONE (commit pending)

**Description:** The three primitives from §2/§9: `generateSalt()` → 16 random bytes hex;
`hashPassword(password, salt)` → HMAC-SHA256 hex; `verifyPassword(password, salt, expectedHash)`
using `crypto.timingSafeEqual`; `generateResetToken()` → `sha1(randomBytes(20))` hex. Pure functions,
no I/O, no database — buildable in parallel with T1–T3.

**Acceptance criteria:**
- [x] `hashPassword` is deterministic for a fixed (password, salt) and returns 64 hex chars
- [x] Two `generateSalt()` calls differ; salt is 32 hex chars
- [x] `verifyPassword` returns false for a wrong password and does not throw on a length mismatch
- [x] `generateResetToken()` returns 40 hex chars and differs across calls

**Verification:**
- [x] `node --test tests/crypto.test.js` — 6/6 pass (no DB/env needed)

**Dependencies:** None
**Files:** `secure/services/crypto.js`, `secure/tests/crypto.test.js`
**Scope:** S

---

### - [x] T5: `services/passwordPolicy.js` + `config.json` + dictionary — DONE (commit pending)

**Description:** Load `config.json` on **every** validation call (plan A5 — no mtime cache) and
enforce the five rules in §7, returning `{ valid, errors: [...] }` with **all** violations at once.
Ship `data/common-passwords.txt` (~250 entries; expandable — see summary/Q5). Includes the A1 proof
test: rewrite `config.json` with `passwordLength: 14` at runtime and assert a 12-char password now
fails, with no restart.

**Acceptance criteria:**
- [x] Each of `passwordLength`, the four `complexity` flags, and `blockDictionaryWords` rejects independently and reports its own error string
- [x] A password violating three rules returns three errors in one response
- [x] Setting `complexity.requireSpecialChars: false` makes a previously-rejected password pass — no code change, no restart
- [x] `historyCount` and `maxLoginAttempts` are exposed via `policy()` for T8/T10 to consume

**Verification:**
- [x] `node --test tests/password-policy.test.js` — 8/8 pass, incl. A1/SC7; config.json restored intact
- [ ] Manual (browser, at C′): edit `config.json` → `passwordLength: 14`, POST a 12-char password, get a rejection (SC7)

**Dependencies:** None (T1 for the tree to exist)
**Files:** `secure/services/passwordPolicy.js`, `secure/config.json`, `secure/data/common-passwords.txt`, `secure/tests/password-policy.test.js`
**Scope:** M

---

### - [x] T6: Register slice — `POST /api/register` + page — DONE (live-verified)

**Description:** First vertical slice: API + page + client JS + test. Validate policy → generate
salt → HMAC → insert user → insert the **same `(hash, salt)` pair** as the first `password_history`
row (plan A8 — history holds one row per password, written when it becomes active, and each row
carries its own salt). Parameterized SQL. Client page
lists policy violations returned by the server; the client does **no** validation of its own beyond
"field is non-empty" (§2 — client validation is UX, and the tests prove enforcement is server-side).

**Acceptance criteria:**
- [x] `POST /api/register` returns `201 {id, username}` and the row exists with a 64-char hash and a 32-char salt
- [x] A policy-violating password returns `400` with `details: [...]`, and **no** user row is created
- [x] A duplicate username returns `409`
- [x] `password_history` has exactly one row for the new user, and its `(password_hash, salt)` equals the pair on `users`
- [x] Test fixtures use the `__test_<runId>_` username prefix and are removed in `after()` — no `TRUNCATE` (plan A6); verified 0 leftover rows
- [x] `supertest` calls the API directly (bypassing the browser) and enforcement holds — server-side proven

**Verification:**
- [x] ✅ **live against RDS:** `tests/auth.test.js` register cases 5/5; full `npm test` 23/23
- [ ] Manual (browser): register at `/register.html`, see the error list, then succeed (U1) — page + assets serve 200; needs a human browser

**Note:** `npm test` script changed `tests/` → `tests/*.test.js` — the directory arg fails on this Node/Windows (treated as a module); glob preserves the spec's intent.

**Dependencies:** T3, T4, T5
**Files:** `secure/routes/auth.js`, `secure/public/register.html`, `secure/public/js/register.js`, `secure/public/js/api.js`, `secure/tests/auth.test.js`
**Scope:** M

---

## Phase 2 — Login and lockout (U2, U3)

### - [x] T7: Login slice — login, logout, `/api/me`, `requireAuth` — DONE (live-verified)

**Description:** `POST /api/login` per the §11 reference snippet, `POST /api/logout`,
`GET /api/me`, and the `requireAuth` middleware. Session id is regenerated on login (session
fixation). `index.html` is the login page titled exactly **"Comunication_LTD Information System"**
(SC3). Note deviation D1: an unknown username returns "User does not exist." because the brief
requires it.

**Acceptance criteria:**
- [x] Correct credentials return `200 {username}` and set a session cookie
- [x] Unknown username returns `401` with the distinct "does not exist" message (D1)
- [x] Wrong password returns `401` with a distinct message
- [x] `GET /api/me` returns `401` without a session and `200 {username}` with one
- [x] Logout returns `204` and a subsequent `/api/me` is `401`
- [x] The session id after login differs (regenerated) — asserted across two logins on one agent

**Verification:**
- [x] ✅ **live:** `tests/auth.test.js` 11/11 (login cases use `supertest.agent()` per R10); full `npm test` 29/29
- [x] `index.html` `<title>` is byte-exact `Comunication_LTD Information System` (SC3)

**Dependencies:** T6
**Files:** `secure/routes/auth.js`, `secure/middleware/requireAuth.js`, `secure/public/index.html`, `secure/public/js/login.js`, `secure/tests/auth.test.js`
**Scope:** M

---

### - [ ] T8: Lockout — attempt counter and `is_locked`

**Description:** Increment `failed_login_attempts` on each wrong password; at
`config.maxLoginAttempts` set `is_locked = 1`. A locked account returns `403` regardless of
credentials. Successful login resets the counter to 0. Per D4 the lock is permanent until the reset
flow clears it (T12).

**Acceptance criteria:**
- [ ] Three consecutive wrong passwords set `is_locked = 1` (SC4)
- [ ] The 4th attempt with the **correct** password returns `403`, not `200` (SC4)
- [ ] Setting `maxLoginAttempts: 5` in `config.json` moves the threshold to 5, no restart (SC8)
- [ ] A successful login before the threshold resets `failed_login_attempts` to 0
- [ ] The counter does **not** increment for an unknown username (nothing to count against)

**Verification:**
- [ ] ⏳ `node --test --test-concurrency=1 --env-file=.env.test tests/auth.test.js` (lockout cases)
- [ ] ⏳ Manual: lock a real account in the browser and confirm the 403 message points at "Forgot password" (U3)

**Dependencies:** T7
**Files:** `secure/routes/auth.js`, `secure/tests/auth.test.js`
**Scope:** S

---

## ✅ Checkpoint B: Authentication works end-to-end

- [ ] SC1, SC3, SC4, SC7, SC8 all pass
- [ ] `npm --prefix secure test` green
- [ ] A human can register and log in through the browser without touching curl
- [ ] No password or hash appears in any response body or server log line
- [ ] **Review with human before proceeding**

---

## Phase 3 — Customers (U7)

### - [ ] T9: Customers slice — the XSS sink, built secure

**Description:** `POST /api/customers` (auth required, `created_by` from the session) and
`GET /api/customers`. `system.html` submits the form and renders the returned name via
**`textContent`** (§10.1 fix), and re-renders the full list on page load. The name is stored
**verbatim** — no input sanitisation, per §13 Never. This file is the one that T17 later reverts.

**Acceptance criteria:**
- [ ] Unauthenticated `POST`/`GET /api/customers` return `401`
- [ ] A created customer is returned by `GET /api/customers` on a later request and a later session
- [ ] A name containing `<img src=x onerror=alert(1)>` is stored byte-identical in the database
- [ ] The same name renders as visible literal text in the browser — no alert, no image element in the DOM
- [ ] Missing `name` returns `400`

**Verification:**
- [ ] ⏳ `node --test --test-concurrency=1 --env-file=.env.test tests/customers.test.js`
- [ ] ⏳ Manual: add the payload as a customer name on `:3000`, confirm literal text; re-login and reload to confirm it stays inert (U7)

**Dependencies:** T8
**Files:** `secure/routes/customers.js`, `secure/public/system.html`, `secure/public/js/system.js`, `secure/tests/customers.test.js`
**Scope:** M

---

## Phase 4 — Password change (U4, U5)

### - [ ] T10: Change-password slice — history enforcement

**Description:** `POST /api/change-password` per §9.2, using the per-row-salt history model
(plan A8):

1. timing-safe check of the current password against `users.password_hash` / `users.salt`;
2. policy validation of the new password;
3. **reuse check** — for each of the last `historyCount` rows of `password_history`, recompute
   `HMAC(new, row.salt)` and reject on a match. There is no single salt that verifies the whole
   history, so this is a loop, not one comparison;
4. on success, generate a **fresh** salt, write `(new_hash, new_salt)` to `users`, insert the same
   pair as a new `password_history` row, and trim rows beyond `historyCount`.

Because history holds one row per password written *when it becomes active*, the current credential
is always the newest history row — so step 3 needs no special case for "the password in force".

**Acceptance criteria:**
- [ ] A wrong current password returns `401` and changes nothing
- [ ] A policy-violating new password returns `400` with `details`
- [ ] Reusing the immediately previous password is rejected (SC5)
- [ ] With `historyCount: 3`, reusing the password from 3 changes ago is rejected; from 4 changes ago is **accepted**
- [ ] Each change produces a **different** salt on `users`, and the matching `password_history` row stores that same salt
- [ ] The reuse check still fires across a salt rotation — i.e. a rejected reuse is proven against a row whose salt differs from the current one (this is the assertion that would have failed under the discarded frozen-salt design)
- [ ] `password_history` never exceeds `historyCount` rows per user

**Verification:**
- [ ] ⏳ `node --test --test-concurrency=1 --env-file=.env.test tests/password-history.test.js`
- [ ] ⏳ Manual: change password twice in the browser, then try to reuse the original (U4, U5)

**Dependencies:** T8
**Files:** `secure/routes/password.js`, `secure/public/change-password.html`, `secure/public/js/change-password.js`, `secure/tests/password-history.test.js`
**Scope:** M

---

## Phase 5 — Password reset (U6)

### - [ ] T11: Forgot slice — mailer + token issuance

**Description:** `services/mailer.js` (nodemailer, Gmail SMTP from `.env`) and `POST /api/forgot`:
look up by email, generate `sha1(randomBytes(20))`, store it in `reset_token` with
`reset_token_expires = now + RESET_TOKEN_TTL_MINUTES`, and email it. Per D3 the emailed value and
the stored value are the same — the brief requires it; the report says why that is weak.

**Acceptance criteria:**
- [ ] A valid email results in a `reset_token` of 40 hex chars and a future `reset_token_expires`
- [ ] A real email arrives at a real inbox containing that value (SC6)
- [ ] Requesting a second token replaces the first — the old value stops working
- [ ] An SMTP failure returns `500` without leaking credentials, and the token is not left half-issued

**Verification:**
- [ ] ⏳ `node --test --test-concurrency=1 --env-file=.env.test tests/reset-flow.test.js` (issuance cases; mailer stubbed in test)
- [ ] ⏳ Manual: trigger from `/forgot-password.html` and read the real email (U6) — the one step that needs Q2 answered

**Dependencies:** T10 (reset reuses its history logic), **and open question Q2**
**Files:** `secure/services/mailer.js`, `secure/routes/password.js`, `secure/public/forgot-password.html`, `secure/public/js/forgot-password.js`
**Scope:** M

---

### - [ ] T12: Reset slice — token redemption and unlock

**Description:** `POST /api/reset`: match the token, check expiry, apply policy **and history**
(reusing T10's per-row-salt logic verbatim — one shared function, not a second copy), write the new
hash with a **fresh salt** plus its `password_history` row exactly as T10 does, clear the token, and
set `is_locked = 0` and `failed_login_attempts = 0` — closing the U3 → U6 loop from §6.

**Acceptance criteria:**
- [ ] A valid, unexpired token with a compliant password returns `200` and login works with the new password
- [ ] An expired token returns `400` and the password is unchanged
- [ ] An unknown/already-used token returns `400`
- [ ] A token that is valid but whose new password violates policy or history returns `400` and the token is **not** consumed
- [ ] Redeeming a token on a locked account unlocks it — login then succeeds (SC4 tail)
- [ ] A reset that reuses a password from history is rejected, proving T10's function is shared and not reimplemented

**Verification:**
- [ ] ⏳ `node --test --test-concurrency=1 --env-file=.env.test tests/reset-flow.test.js`
- [ ] ⏳ Manual: lock an account with 3 bad logins, recover it entirely through the browser (U3 + U6 as one story)

**Dependencies:** T11
**Files:** `secure/routes/password.js`, `secure/public/reset-password.html`, `secure/public/js/reset-password.js`, `secure/tests/reset-flow.test.js`
**Scope:** M

---

## ✅ Checkpoint C′: JOINT live-connection session + secure build feature-complete

**Run this one together — it is the session the developer asked to be present for (plan A2).** Every
⏳ item from T1–T12 clears here, in this order. Expect the first pass to fail; that is the point of
doing it as a block with someone who can change AWS settings in the same minute.

**Part 1 — connectivity (developer at the keyboard for AWS/Google)**
- [ ] `npm --prefix secure run preflight` → `DB: ok` and `SMTP: ok`
- [ ] If DB fails: add the printed public IP to the RDS security group (TCP 3306) and confirm the instance is publicly accessible; if TLS fails, fetch `global-bundle.pem` — **never** `rejectUnauthorized: false`
- [ ] If SMTP fails: confirm 2FA is on for the Gmail account and the 16-char app password is in `.env`

**Part 2 — schema**
- [ ] `npm --prefix secure run db:init` twice, both exit 0
- [ ] `SHOW CREATE TABLE password_history` shows the `salt CHAR(32)` column (plan A8)
- [ ] `SHOW CREATE TABLE users` shows `is_locked` and `reset_token CHAR(40)`

**Part 3 — the deferred backlog, all at once**
- [ ] `npm --prefix secure test` green — every suite queued since T6 runs for the first time
- [ ] SC1–SC8 all pass
- [ ] Every screen in §5 of the brief works in a browser
- [ ] A real reset email was received and redeemed (SC6)
- [ ] After the run, the demo data is intact — no suite truncated anything (risk R4b); `npm run db:clean-tests` reports nothing left behind

- [ ] **Review with human before proceeding** — after this the tree gets copied, and every later change costs double

---

## Phase 6 — Secure hardening and regression

### - [ ] T13: `secure/tests/attacks.test.js` + leak checks

**Description:** The negative half of the asymmetric suite (§12). Send the §10 payloads as raw HTTP
and assert they fail. Add the SC13 leak assertions and the SC14 static check that no SQL string in
`secure/routes/` contains an interpolation.

**Acceptance criteria:**
- [ ] `' OR '1'='1' -- ` as username returns `401` on login, not `200` (SC12)
- [ ] A UNION payload in the customer path returns `400`/`401` and leaks no `users` columns (SC12)
- [ ] The stored XSS payload round-trips byte-identically through `POST`→`GET /api/customers` — stored verbatim, escaped at render, not at storage
- [ ] No response body in the whole suite contains `password_hash`, `salt`, `at Object.`, or `ER_` (SC13)
- [ ] A repo check reports zero `${` inside a SQL string literal under `secure/routes/` (SC14)

**Verification:**
- [ ] `node --test --test-concurrency=1 --env-file=.env.test tests/attacks.test.js` (runs at C′ or later — Phase 6 sits after the joint session)
- [ ] `git grep -n '\${' secure/routes/` — no database needed; manual read of any hit

**Dependencies:** T12
**Files:** `secure/tests/attacks.test.js`, `secure/scripts/check-sql.js`
**Scope:** S

---

### - [ ] T14: Seed, final scripts, ESLint

**Description:** `scripts/seed.js` creating one known demo user and a few benign customers (the R8
escape hatch), `scripts/clean-tests.js` deleting `__test_%` leftovers (risk R4b), finalise every npm
script in §4 to its exact command, and add a minimal ESLint 9 flat config. *Drop the ESLint half if
open question Q3 says so.*

**Acceptance criteria:**
- [ ] `npm run db:seed` is idempotent and prints the demo credentials it created
- [ ] `npm run db:clean-tests` deletes only `__test_%` rows and reports the count, leaving demo data untouched
- [ ] All ten scripts in §4 exist and run
- [ ] `npm run lint` passes clean across the tree
- [ ] Test commands include `--test-concurrency=1` (plan A6)
- [ ] `git grep -in 'truncate' secure/tests/` returns nothing (risk R4b)

**Verification:**
- [ ] Run each of the eight scripts once
- [ ] `npm --prefix secure test` green from a freshly seeded database

**Dependencies:** T13
**Files:** `secure/scripts/seed.js`, `secure/scripts/clean-tests.js`, `secure/package.json`, `secure/eslint.config.js`
**Scope:** M

---

## ✅ Checkpoint D: Secure build is hardened and green

- [ ] SC12, SC13, SC14 pass
- [ ] `npm --prefix secure test` green, including the attack suite
- [ ] `npm run lint` clean
- [ ] Definition of Done "Security posture" section verified by reading `routes/` top to bottom
- [ ] **Review with human before proceeding** — `secure/` is now frozen as the baseline

---

## Phase 7 — Vulnerable twin

### - [ ] T15: Derive `vulnerable/` from `secure/`

**Description:** Copy the whole `secure/` tree to `vulnerable/` (excluding `node_modules` and
`.env`), then change only the environment: port 3001, `DB_NAME=comm_ltd_vulnerable`. Install and
initialise the second database. **No code changes in this task** — this step must produce a
byte-identical, still-secure second app, so that T16/T17 are the only source of divergence.

**Acceptance criteria:**
- [ ] `vulnerable/` runs on `:3001` against `comm_ltd_vulnerable` with all §5 screens working
- [ ] Immediately after this task, `diff -r -q secure vulnerable -x node_modules -x .env -x package-lock.json` reports **only** `.env.example`
- [ ] The vulnerable app cannot reach `comm_ltd_secure` (§13 Never)

**Verification:**
- [ ] `npm --prefix vulnerable install && npm --prefix vulnerable run db:init && npm --prefix vulnerable start`
- [ ] Both apps running simultaneously on 3000 and 3001
- [ ] `npm --prefix vulnerable test` green (still the secure suite at this point)

**Dependencies:** T14
**Files:** `vulnerable/**` (copy), `vulnerable/.env`, `vulnerable/.env.example`
**Scope:** M

---

### - [ ] T16: Reintroduce SQL injection (3 route modules)

**Description:** Replace `pool.execute(sql, params)` with template-literal concatenation and
`pool.query()` in `vulnerable/routes/auth.js`, `password.js`, and `customers.js`, each carrying the
`// !! INTENTIONALLY VULNERABLE — see SPEC.md §10.2 !!` banner. `multipleStatements` stays `false`
(risk R6) — the demo relies on `OR '1'='1'` and `UNION`, never on stacked statements.

**Acceptance criteria:**
- [ ] Username `' OR '1'='1' -- ` with any password returns `200` and a session on `:3001` (SC9)
- [ ] A UNION payload returns rows sourced from `users` on `:3001` (SC11)
- [ ] Every reintroduced flaw carries the banner comment and a §10 reference
- [ ] `multipleStatements` is still `false` in `vulnerable/db/connection.js`

**Verification:**
- [ ] Manual `curl` of both payloads against `:3001`, captured for T19
- [ ] The identical payloads still fail against `:3000`

**Dependencies:** T15
**Files:** `vulnerable/routes/auth.js`, `vulnerable/routes/password.js`, `vulnerable/routes/customers.js`
**Scope:** S

---

### - [ ] T17: Reintroduce the stored-XSS render sink

**Description:** One line in `vulnerable/public/js/system.js`: `textContent` → `innerHTML`, with the
banner comment. Storage is already verbatim in both trees, so nothing server-side changes — which is
the point the report makes about where the vulnerability actually lives.

**Acceptance criteria:**
- [ ] A customer named `<img src=x onerror="alert(document.cookie)">` fires an alert on `:3001` on submit (SC10)
- [ ] It fires **again** on a fresh page load after logout and re-login — proving *stored*, not reflected (SC10)
- [ ] The same record renders as literal text on `:3000`
- [ ] The change is exactly one line plus the banner

**Verification:**
- [ ] Manual in a real browser on both ports, screenshotted for T19

**Dependencies:** T15
**Files:** `vulnerable/public/js/system.js`
**Scope:** XS

---

### - [ ] T18: `vulnerable/tests/attacks.test.js` + drift check

**Description:** Invert the secure attack suite: assert the SQLi payloads **succeed**. A red suite
here means a vulnerability was accidentally fixed (§12). Add `scripts/check-drift.sh` at the repo
root implementing plan A4.

**Acceptance criteria:**
- [ ] `npm --prefix vulnerable test` is green, where green means the attacks succeeded
- [ ] `npm --prefix secure test` is still green, where green means the same payloads failed
- [ ] `scripts/check-drift.sh` reports exactly the six files listed in plan A4, and exits non-zero on a seventh

**Verification:**
- [ ] Both suites run back to back
- [ ] `bash scripts/check-drift.sh`

**Dependencies:** T16, T17
**Files:** `vulnerable/tests/attacks.test.js`, `scripts/check-drift.sh`
**Scope:** S

---

## ✅ Checkpoint E: Both builds run, attacks are asymmetric

- [ ] SC9, SC10, SC11 pass on `:3001`; SC12 passes on `:3000`
- [ ] `npm --prefix secure test` **and** `npm --prefix vulnerable test` both green
- [ ] `scripts/check-drift.sh` reports exactly six differing files
- [ ] Both apps run side by side and use separate databases
- [ ] **Review with human before proceeding**

---

## Phase 8 — Evidence and delivery

### - [ ] T19: `docs/attack-report.md` + screenshots

**Description:** The graded artefact (§10.3, brief §7). Per vulnerability: exact payload, the
request, a screenshot succeeding on `:3001`, a screenshot failing on `:3000`, the impact, the fix,
and the code diff. Plus the §14 Deliberate Deviations table and the explicit statement that
client-side validation is not a security control.

**Acceptance criteria:**
- [ ] Both vulnerabilities documented with payload, impact, fix, and before/after screenshots (SC16)
- [ ] The stored-XSS section shows the *persistence* screenshot (fresh load after re-login), not only the submit-time alert
- [ ] All four D1–D4 deviations are explained with their correct alternatives
- [ ] The client-side-validation note is present and justified with the `curl` evidence from T6

**Verification:**
- [ ] A reader who has never seen the repo can reproduce both attacks from this document alone
- [ ] Every screenshot in `docs/screenshots/` is referenced from the text

**Dependencies:** T18
**Files:** `docs/attack-report.md`, `docs/screenshots/*`
**Scope:** M

---

### - [ ] T20: `README.md` + full §16 sweep

**Description:** Setup instructions (RDS security group, `.env` from `.env.example`, `db:init`,
Gmail app password), how to run both builds, the demo walkthrough, and a final pass confirming all
17 success criteria in §16. Update `SPEC.md` if any decision drifted during implementation — the
spec is the living contract.

**Acceptance criteria:**
- [ ] A clean clone can be brought to two running apps using only the README (SC1)
- [ ] All 17 criteria in §16 are checked off with the command or screenshot that proves each
- [ ] `git ls-files` shows no `.env`; `.env.example` present in both trees (SC17)
- [ ] `SPEC.md` §17 open questions are all resolved or explicitly marked as out of scope

**Verification:**
- [ ] Fresh-clone dry run following the README verbatim
- [ ] `git ls-files | grep -c '\.env$'` returns 0

**Dependencies:** T19
**Files:** `README.md`, `SPEC.md`, `tasks/todo.md`
**Scope:** S

---

## ✅ Checkpoint F: Ready to submit

- [ ] All 17 success criteria in §16 verified
- [ ] Both test suites green with their opposite meanings
- [ ] `scripts/check-drift.sh` clean
- [ ] No secret is committed anywhere in history
- [ ] `docs/attack-report.md` is reproducible by a stranger
- [ ] **Final review with human**
