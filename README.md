# Comunication_LTD — Secure Information System

A web-based information system for a fictional ISP: an authenticated **employee** logs in, manages
their own credentials, and registers **customers** (data records). It ships **twice** — an
intentionally **vulnerable** build and a **secure** build — so that Stored XSS and SQL Injection can
be demonstrated *succeeding* on one and *failing* on the other.

- **Spec:** [`SPEC.md`](SPEC.md) (governs implementation) · course brief: [`Comunication_LTD_Spec.md`](Comunication_LTD_Spec.md)
- **Attack evidence:** [`docs/attack-report.md`](docs/attack-report.md)
- **Plan / tasks:** [`tasks/plan.md`](tasks/plan.md), [`tasks/todo.md`](tasks/todo.md)

| Build | Directory | Port | Database |
|---|---|---|---|
| Secure | `secure/` | 3000 | `secure_app_db` |
| Vulnerable | `vulnerable/` | 3001 | `vulnerable_app_db` |

> The two trees are byte-identical except **six** files (`bash scripts/check-drift.sh` enforces it):
> `routes/auth.js`, `routes/password.js`, `routes/customers.js`, `public/js/system.js`,
> `tests/attacks.test.js`, `.env.example`.

---

## Prerequisites

- **Node.js v22.x** (uses built-in `--test`, `--env-file`). Verified on v22.17.1.
- **MySQL 8.x** — an **AWS RDS** instance (TLS required). Two schemas on it: `secure_app_db`,
  `vulnerable_app_db` (created by `db:init`).
- **A Gmail account** with 2-Step Verification, to send password-reset emails (App Password).

---

## Setup

### 1. Install

```
npm --prefix secure install
npm --prefix vulnerable install
```

### 2. Configure each build's `.env`

Copy the example and fill in real values (`.env` is gitignored — never commit it):

```
cp secure/.env.example      secure/.env
cp vulnerable/.env.example  vulnerable/.env
```

Fill in, in **each** `.env`:

- `SESSION_SECRET` — 32+ random hex bytes:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `DB_HOST`, `DB_PORT` (3306), `DB_USER`, `DB_PASSWORD` — your RDS credentials. Leave the tree's
  `DB_NAME` as shipped (`secure_app_db` / `vulnerable_app_db`) and `DB_SSL=true`.
- `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` — Gmail address + **16-char App Password**
  (Google Account → Security → 2-Step Verification → App passwords). Not your login password.

For running the test suites, also create `.env.test` in each tree — identical to `.env` but with
`PORT=0` (ephemeral port for supertest):

```
node -e "let s=require('fs').readFileSync('secure/.env','utf8').replace(/^PORT=.*/m,'PORT=0');require('fs').writeFileSync('secure/.env.test',s)"
node -e "let s=require('fs').readFileSync('vulnerable/.env','utf8').replace(/^PORT=.*/m,'PORT=0');require('fs').writeFileSync('vulnerable/.env.test',s)"
```

### 3. RDS reachability (one-time)

- In the RDS security group, allow inbound **TCP 3306** from your machine's public IP.
- TLS: the trees ship AWS's public CA bundle at `db/global-bundle.pem` and use it automatically
  (`ssl.rejectUnauthorized` stays `true` — never disable it). If your IP changes, re-add the rule;
  `npm run preflight` prints your current public IP on failure.

### 4. Verify connectivity, then create the schema

```
npm --prefix secure     run preflight     # expect: DB: ok (…) / SMTP: ok
npm --prefix vulnerable run preflight
npm --prefix secure     run db:init        # creates secure_app_db + tables (idempotent)
npm --prefix vulnerable run db:init        # creates vulnerable_app_db + tables
npm --prefix secure     run db:seed        # optional demo login: demo / Comm7#Ltdxyz + 3 customers
npm --prefix vulnerable run db:seed
```

---

## Run both builds

```
npm --prefix secure     start     # http://localhost:3000
npm --prefix vulnerable start     # http://localhost:3001
```

Open each in a browser. Both serve the login page titled **"Comunication_LTD Information System"**.

### Demo walkthrough (either build)

1. **Register** at `/register.html` (a weak password shows the policy errors; a strong one succeeds).
2. **Log in** at `/` → the **System** page.
3. **Add a customer** — the name is rendered back and the list reloads on every visit.
4. **Change password** (top-right) — reusing a recent password is rejected.
5. **Forgot password** → check the inbox for the token → **Reset password** (also unlocks the account).

### The two attacks (see [`docs/attack-report.md`](docs/attack-report.md) for full detail)

- **SQLi login bypass:** log in with username `' OR '1'='1' -- ` and any password →
  **succeeds on :3001**, **refused on :3000**.
- **SQLi data leak:** in the customer Search box paste
  `' UNION SELECT id, username, password_hash, salt, 1, 1, 1, NOW() FROM users -- ` →
  **leaks the users table on :3001**, **no data on :3000**.
- **Stored XSS:** add a customer named `<img src=x onerror="alert(document.cookie)">` →
  **alert fires on :3001** (again after re-login — it's stored), **inert text on :3000**.

---

## Testing

```
npm --prefix secure     test     # 58/58 — the attack payloads FAIL (payloads are inert)
npm --prefix vulnerable test     # 56/56 — the attack payloads SUCCEED (this is the evidence)
npm --prefix secure     run check:sql    # SC14: no SQL string interpolation in secure/routes/
bash scripts/check-drift.sh              # the two trees differ in exactly the six intended files
```

Tests run against each tree's own database. They never `TRUNCATE`: every fixture is prefixed
`__test_` and self-deletes; `npm run db:clean-tests` removes leftovers from a crashed run.

---

## Configuration (`config.json`)

Password policy is read from `config.json` on every validation — edit it and behavior changes with
**no restart, no code change**:

```json
{ "passwordLength": 10, "complexity": { "requireUppercase": true, "requireLowercase": true,
  "requireDigits": true, "requireSpecialChars": true },
  "historyCount": 3, "blockDictionaryWords": true, "maxLoginAttempts": 3 }
```

---

## Success criteria (SPEC §16)

| # | Criterion | How it's proven |
|---|---|---|
| 1 | Both builds boot and serve their login page | `npm --prefix … start`; `curl :3000/` `:3001/` → 200 |
| 2 | Register → login → add customer → change → reset, end to end | Browser walkthrough above; suites cover each path |
| 3 | Login title is exactly "Comunication_LTD Information System" | `secure/public/index.html` `<title>` (byte-exact) |
| 4 | 3 wrong passwords lock; 4th correct still refused; reset unlocks | `auth.test.js` (SC4), `reset-flow.test.js` |
| 5 | Reusing any of the last 3 passwords is rejected | `password-history.test.js` (SC5) |
| 6 | A real reset email arrives with a working 40-char token | `preflight` SMTP ok; verified — a real email was delivered |
| 7 | `passwordLength=14` makes a 12-char password fail, no restart | `password-policy.test.js` (A1/SC7) |
| 8 | `maxLoginAttempts=5` changes the threshold | `auth.test.js` (SC8) |
| 9 | `' OR '1'='1' -- ` logs in on :3001 | `vulnerable/tests/attacks.test.js`; report §1a |
| 10 | Stored XSS fires on :3001, incl. after re-login | Report §2; screenshots `05`,`06` |
| 11 | UNION payload returns `users` rows on :3001 | `vulnerable/tests/attacks.test.js`; report §1b |
| 12 | Payloads 9–11 all fail on :3000 | `secure/tests/attacks.test.js` |
| 13 | No stack/SQL/hash/salt in any secure response | `attacks.test.js` no-leak sweep (SC13) |
| 14 | No SQL-string interpolation in `secure/routes/` | `npm run check:sql` (SC14) |
| 15 | Secure suite green; vulnerable suite green (attacks succeed) | 58/58 and 56/56 |
| 16 | Attack report with payloads, impact, fixes, screenshots | [`docs/attack-report.md`](docs/attack-report.md) |
| 17 | No `.env` tracked; `.env.example` in both trees | `git ls-files` → 0 `.env`, 2 `.env.example` |

**Pending (needs a real browser):** the seven screenshots in `docs/screenshots/` — see its README.

---

## Security notes

The build implements four course-mandated deviations from best practice (username enumeration, fast
HMAC hashing, plaintext-equivalent reset tokens, permanent lockout). Each is deliberate and explained,
with its safe alternative, in [`docs/attack-report.md`](docs/attack-report.md) §Deviations. Client-side
validation is UX only — every security decision is enforced server-side.
