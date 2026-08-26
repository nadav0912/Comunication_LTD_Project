# Comunication_LTD — Project Specification

**Course:** Cyber / Secure Development — Final Project
**System:** Web-based information system for a fictional ISP ("Comunication_LTD")
**Goal:** Build a web app backed by a relational database that (a) demonstrates secure development principles, and (b) demonstrates common web vulnerabilities (Stored XSS and SQL Injection) alongside their fixes.

---

## 1. Overview

Comunication_LTD is a fictional telecom company that sells internet packages. The system lets an authenticated employee (a *user*) log in, manage their account, and register *customers* (data records — customers do **not** log in). The project is submitted in **two versions**: one intentionally **vulnerable** and one **secure**.

There is only one kind of login account (the employee/user). "Customer" is a data record, not a login. "Administrator" appears only as the person who edits the configuration file on the server — it is not an in-app role and no admin screen is required.

---

## 2. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Server | Node.js + Express | JSON API only — no server-side templating |
| Database | MySQL | Relational; use `mysql2` driver |
| Client | Static HTML + CSS + Bootstrap + vanilla JS (`fetch`) | Pages are plain HTML; JS calls the API and renders results into the DOM |
| Crypto | Node built-in `crypto` | `hmac` for password hashing, `sha1` for reset tokens |

**Architecture:** Express serves static HTML from `public/` and exposes a JSON API under `/api/*`. Client-side JS uses `fetch()` to call the API and injects the results into the DOM. There is no template engine — you control escaping yourself, which is exactly what the XSS demo hinges on (`innerHTML` = vulnerable, `textContent`/encoding = secure).

Two notes:
- Client-side validation is a convenience only. **All security checks (password policy, input handling) must be enforced on the server**, because client-side JS is trivially bypassed.
- Since auth spans multiple `fetch` calls, use session cookies and call `fetch(..., { credentials: 'same-origin' })` so the session travels with each request (or use a token stored in memory).

---

## 3. Database Schema

### `users`
| Column | Type | Notes |
|---|---|---|
| id | INT, PK, auto-increment | |
| username | VARCHAR, unique | |
| email | VARCHAR | |
| password_hash | VARCHAR | HMAC output |
| salt | VARCHAR | Random per-user salt |
| failed_login_attempts | INT, default 0 | Reset on success; lock after threshold |
| reset_token | VARCHAR, nullable | SHA-1 value for "forgot password" |
| reset_token_expires | DATETIME, nullable | Optional expiry |
| created_at | DATETIME | |

### `password_history`
| Column | Type | Notes |
|---|---|---|
| id | INT, PK | |
| user_id | INT, FK → users.id | |
| password_hash | VARCHAR | Previous HMAC values |
| created_at | DATETIME | Used to enforce "no reuse of last N passwords" |

### `customers`
| Column | Type | Notes |
|---|---|---|
| id | INT, PK, auto-increment | |
| name | VARCHAR | The field used to demonstrate Stored XSS |
| ...other details | | e.g. package, sector, contact — as desired |
| created_by | INT, FK → users.id | Optional |

---

## 4. Configuration File (Password Policy)

Password policy is **not hard-coded**. It lives in an external config file (e.g. `config.json`) that the administrator can edit without touching code.

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

The server reads this file and enforces every rule from it. Changing a value here (e.g. `passwordLength` to 12) must change the actual behavior with no code edits.

---

## 5. Part A — Secure Development (Functional Requirements)

### 5.1 Register Screen
Fields: username, email, password.
- Password must satisfy the complex-password rules loaded from the config file.
- Password is **never stored in plaintext**. Generate a random `salt`, compute `HMAC(password, salt)`, and store the resulting `password_hash` + `salt`.
- On success, create the user record.

### 5.2 Change Password Screen
Fields: current password, new password.
- Verify the current password (recompute HMAC and compare).
- New password must satisfy the config policy.
- Enforce **password history**: reject if the new password matches any of the last `historyCount` (3) passwords. On success, push the old hash into `password_history`.

### 5.3 Login Screen
Title: "Comunication_LTD Information System". Fields: username, password.
- Check whether the user exists and return an appropriate message.
- Enforce **max login attempts** (3): after 3 consecutive failures, lock the account (or block further attempts).
- Reset the failure counter on successful login.

### 5.4 System Screen (Add Customer)
- Authenticated users add a new customer with their details.
- The system then **displays the newly entered customer name** on the screen.
- ⚠️ This screen is the target for the **Stored XSS** demonstration in Part B.

### 5.5 Forgot Password Screen
- User triggers the "forgot password" option.
- System generates a **random value hashed with SHA-1**, stores it (`reset_token`), and emails it to the user.
- User enters this value to unlock the change-password screen and set a new password (which must meet the config policy).

---

## 6. Part B — Vulnerabilities (XSS + SQLi)

Two working versions of the project are submitted: **Vulnerable** and **Secure**.

### 6.1 Stored XSS
- **Where:** Section 5.4 (Add Customer — the customer name field).
- **Still "Stored" XSS:** the payload is saved in the DB, returned later by the API, and executed when rendered — the source is stored data, the sink is client-side DOM.
- **Vulnerable version:** the client JS renders the fetched customer name with `element.innerHTML = name`. A payload like `<img src=x onerror=alert(document.cookie)>` entered as a name executes when the name is displayed. (Note: a bare `<script>` inserted via `innerHTML` won't run, so use an event-handler payload like `onerror` for the demo.)
- **Fix:** render with `element.textContent = name` (or HTML-encode special characters before insertion), so the payload is shown as inert text.

### 6.2 SQL Injection
- **Where:** Sections 5.1 (Register), 5.2/5.3 (password / login), and 5.4 (Add Customer).
- **Vulnerable version:** Build SQL by concatenating user input directly into the query string. A payload like `' OR '1'='1` bypasses authentication or leaks/alters data.
- **Fix:** Use **parameterized queries** (prepared statements via `mysql2`) or **stored procedures**, so user input is never interpreted as SQL.

### 6.3 Summary of Fixes Required
| Vulnerability | Location | Fix technique |
|---|---|---|
| Stored XSS | 5.4 | Encode special characters on output |
| SQL Injection | 5.1, 5.2/5.3, 5.4 | Parameterized queries / stored procedures |

---

## 7. Deliverables

1. **Vulnerable version** — code that exposes the Part B vulnerabilities, with a short document/screenshots demonstrating each successful attack.
2. **Secure version** — the same app with all vulnerabilities fixed, demonstrating the attacks now fail.
3. Working relational database (schema + seed as needed).
4. External configuration file controlling the password policy.
5. (Recommended) A short report describing each attack, its impact, and the fix — including the note that client-side validation is not a security control.

---

## 8. Suggested Build Order

1. Database schema (`users`, `password_history`, `customers`).
2. Config file + a server-side module that loads and enforces the password policy.
3. Register → Login (with HMAC+Salt and attempt-locking).
4. Change Password (with history enforcement).
5. Add Customer screen.
6. Forgot Password (SHA-1 token + email).
7. Build the **vulnerable** paths for XSS and SQLi, demonstrate the attacks.
8. Apply fixes to produce the **secure** version.

---

## 9. Project File Structure

```
comunication-ltd/
├── config.json                 # Password policy (Section 4) — admin-editable
├── package.json                # Dependencies: express, mysql2, nodemailer, dotenv
├── .env                        # DB credentials, mail credentials (never commit)
├── server.js                   # Express: serves /public statically, mounts /api routes, session
│
├── db/
│   ├── connection.js           # mysql2 connection pool
│   └── schema.sql              # CREATE TABLE users, password_history, customers
│
├── routes/                     # API endpoints — return JSON, never HTML
│   ├── auth.js                 # POST /api/register, /api/login, /api/logout   (5.1, 5.3)
│   ├── password.js             # POST /api/change-password, /api/forgot, /api/reset (5.2, 5.5)
│   └── customers.js            # POST /api/customers, GET /api/customers         (5.4)
│
├── services/
│   ├── passwordPolicy.js       # Loads config.json; validates length/complexity/history/dictionary
│   ├── crypto.js               # HMAC + Salt (passwords), SHA-1 (reset token)
│   └── mailer.js               # Sends the SHA-1 reset value by email
│
├── data/
│   └── common-passwords.txt    # Dictionary list for blockDictionaryWords
│
├── public/                     # static files served directly to the browser
│   ├── index.html              # Login page
│   ├── register.html
│   ├── change-password.html
│   ├── forgot-password.html    # Request reset
│   ├── reset-password.html     # Enter SHA-1 value + new password
│   ├── system.html             # Add customer + display entered name
│   ├── css/
│   │   └── style.css           # (or load Bootstrap from CDN in each page's <head>)
│   └── js/
│       ├── api.js              # Shared fetch() wrappers (credentials, JSON, error handling)
│       ├── register.js
│       ├── login.js
│       ├── change-password.js
│       ├── forgot-password.js
│       ├── reset-password.js
│       └── system.js           # Renders the customer name  ← XSS sink lives here
│
└── README.md                   # Setup, how to run, attack demo notes
```

### Where the two versions differ

The **vulnerable** and **secure** builds share this exact structure. The differences are localized to just two places, which keeps the diff easy to show in your report:

- **SQL Injection** → the query code in `routes/auth.js`, `routes/password.js`, `routes/customers.js` (string concatenation vs. parameterized queries). Server-side.
- **Stored XSS** → the customer-name rendering in `public/js/system.js` (`element.innerHTML = name` raw vs. `element.textContent = name` / encoded). Client-side.

Recommended submission layout — two sibling folders so both run independently:

```
project-root/
├── vulnerable/    # full copy of the tree above, vulnerable code paths
└── secure/        # full copy of the tree above, fixed code paths
```
