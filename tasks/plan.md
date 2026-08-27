# Implementation Plan: Comunication_LTD Secure Information System

**Source of truth:** [`SPEC.md`](../SPEC.md). Section references below (§n) point at
`SPEC.md` unless stated otherwise.

**Task list target:** `tasks/todo.md` (no external tracker configured for this repo).

---

## Overview

Build one complete, working, **secure** Express + MySQL application (`secure/`), then derive the
**vulnerable** twin (`vulnerable/`) from it by reverting exactly four files. Verification is
asymmetric by design: the same attack payloads must fail in `secure/tests/attacks.test.js` and
succeed in `vulnerable/tests/attacks.test.js`. The deliverable is not "an app" — it is *a pair of
apps plus reproducible evidence that the pair differs only in the two taught vulnerabilities*.

Twenty tasks across eight phases, six checkpoints. Every task is S or M (≤ 5 files).

---

## Architecture Decisions

**A1 — Foundation is the only horizontal phase; everything after it is a vertical slice.**
Phase 0 (3 tasks) builds the connection pool, schema and Express skeleton because nothing can be
demonstrated without them. From Phase 1 onward each task delivers one complete user-visible path —
route + service + HTML page + client JS + test — so the app is runnable and demoable after every
task, never half-wired.

**A2 — Live-connection verification is a joint session held after the build, not a solo gate before
it.** The two things most likely to stall this project are **AWS RDS reachability** (security group,
public accessibility, TLS handshake) and the **Gmail app password**. Engineering instinct says prove
both on day one; the developer has chosen to run them together once the code exists, and that is the
call being followed. `scripts/preflight.js` is still written in T1 — it costs an hour and makes the
joint session a single command instead of an afternoon of guessing — it is simply **not run** until
Checkpoint C′.

The cost is stated rather than hidden: until that session, every task touching the database is
**code complete, verification pending**. Its acceptance criteria are written but unproven, and the
Definition of Done's "verified at runtime" item cannot be checked. Risks R1–R2 below carry the
consequence.

**A3 — `secure/` is built to completion first, then copied.** This inverts the brief's §8 ordering,
as recorded in §15. Reverting two known code paths in a finished tree is verifiable; "fixing" a
vulnerable tree and hoping nothing was missed is not.

**A4 — Tree drift is caught mechanically, not by discipline.** After Phase 7 the command

```
diff -r -q secure vulnerable -x node_modules -x .env -x package-lock.json
```

must report **exactly six** differing files:

| File | Why it differs |
|---|---|
| `routes/auth.js` | concatenated vs. parameterized SQL |
| `routes/password.js` | concatenated vs. parameterized SQL |
| `routes/customers.js` | concatenated vs. parameterized SQL |
| `public/js/system.js` | `innerHTML` vs. `textContent` |
| `tests/attacks.test.js` | asserts attacks succeed vs. fail |
| `.env.example` | port 3001 / `comm_ltd_vulnerable` |

A seventh differing file is a bug and fails the checkpoint. This turns §5's "any other divergence
between the trees is a bug" from a good intention into a command.

**A5 — `passwordPolicy.js` re-reads `config.json` on every call, with no mtime cache.**
§7 specifies "cached by mtime". The file is ~200 bytes; a `readFileSync` per validation is free,
and it removes a real flake: on a fast test run two writes to `config.json` can land inside the
same filesystem timestamp tick, so an mtime cache would silently serve stale policy and the A1
config-change test (SC7) would fail intermittently. Observable behaviour is identical to §7 —
simpler, and deterministic under test.

**A6 — Two databases, and tests never truncate.** Correcting an inconsistency in the first draft of
this plan: §3 says two databases, and two is what exists — `comm_ltd_secure` and
`comm_ltd_vulnerable`. Tests run against their own tree's database. Since the secure database also
holds demo data, `TRUNCATE` in `beforeEach` would destroy the demo on every test run, so instead
every fixture is prefixed `__test_<runId>_` and each suite deletes only its own rows in `after()`.
Suites run serially (`--test-concurrency=1`) — parallel files against one remote database interfere
and add latency-driven flakiness. `npm run db:clean-tests` clears leftovers from a crashed run.

**A7 — Client JS is plain `<script>` tags, no modules.** `api.js` attaches a small `api` object to
`window`; page scripts use it. No bundler, no `type="module"`, no CORS/file:// complications — the
brief's stack (§2) has no build step, and the XSS demo must be readable by a marker at a glance.

**A8 — One history row per password, salt rotated on every change.** `password_history` gains a
`salt CHAR(32)` column beyond the brief's §3 table, and a fresh salt is generated on every password
change and reset. This replaces the "freeze the salt for the account's lifetime" workaround the
first draft proposed, and it is the better design: with a frozen salt, two identical historical
hashes prove to anyone reading a stolen database that the user reused a password.

Rotating salts means history verification is **per row** — recompute `HMAC(candidate, row.salt)`
against each of the last `historyCount` rows, since no single salt verifies the whole history.

Writing that up exposed a second defect in the first draft: §9.1 had registration write the first
history row while §9.2 appended *the old hash* on change, so after one change the first password sat
in history twice and the current password was never in history at all. The model is now **one row
per password, inserted at the moment it becomes active** — register writes P1, changing to P2 writes
P2 — so the reuse check is exactly "the last `historyCount` rows" with no special case for the
credential currently in force.

---

## Dependency Graph

```
                    ┌──────────────────────────────────────────┐
                    │  T1  scaffolding + preflight.js written   │  ← script written now,
                    └───────────────────┬──────────────────────┘     RUN jointly at Chkpt C′
                                        │
              ┌─────────────────────────┴────────────────┐
              ▼                                          ▼
   ┌──────────────────────┐                   (no dependency — may run
   │ T2 schema + pool     │                    in parallel with T1–T3)
   │    + db:init         │                   ┌────────────────────────┐
   └──────────┬───────────┘                   │ T4 services/crypto.js  │
              ▼                               │ T5 passwordPolicy.js   │
   ┌──────────────────────┐                   └───────────┬────────────┘
   │ T3 express skeleton  │                               │
   │    session, errors   │                               │
   └──────────┬───────────┘                               │
              └───────────────────┬───────────────────────┘
                                  ▼
                     ┌────────────────────────┐
                     │ T6  REGISTER slice     │  U1, A1
                     └───────────┬────────────┘
                                 ▼
                     ┌────────────────────────┐
                     │ T7  LOGIN slice        │  U2
                     └───────────┬────────────┘
                                 ▼
                     ┌────────────────────────┐
                     │ T8  LOCKOUT            │  U3
                     └───────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                                     ▼
   ┌──────────────────────┐              ┌──────────────────────┐
   │ T9  CUSTOMERS slice  │  U7          │ T10 CHANGE-PW slice  │  U4, U5
   │     (XSS sink)       │              │     (history)        │
   └──────────┬───────────┘              └───────────┬──────────┘
              │                                      ▼
              │                          ┌──────────────────────┐
              │                          │ T11 FORGOT slice     │  U6
              │                          │ T12 RESET slice      │  U6, unlock
              │                          └───────────┬──────────┘
              └──────────────────┬───────────────────┘
                                 ▼
                   ┌──────────────────────────┐
                   │ T13 secure attack suite  │  SC12, SC13, SC14
                   │ T14 seed + scripts + lint│
                   └────────────┬─────────────┘
                                ▼
                   ┌──────────────────────────┐
                   │ T15 derive vulnerable/   │
                   │ T16 revert SQL (3 files) │  SC9, SC11
                   │ T17 revert render sink   │  SC10
                   │ T18 vulnerable suite     │
                   └────────────┬─────────────┘
                                ▼
                   ┌──────────────────────────┐
                   │ T19 attack-report + shots│
                   │ T20 README + §16 sweep   │
                   └──────────────────────────┘
```

**Parallelizable:** T4 and T5 have no dependency on T1–T3 (pure functions over `crypto` and a JSON
file) and can be built alongside the foundation. T9 and T10 are independent of each other.
**Strictly sequential:** everything else. T15–T18 cannot start until `secure/` is complete, by A3.

---

## Task List

Full task definitions — description, acceptance criteria, verification, files, scope — are in
[`tasks/todo.md`](todo.md). Index:

### Phase 0 — Foundation
- T1: Repo scaffolding + `preflight.js` (written now, run jointly at C′)
- T2: Schema, connection pool, `db:init`
- T3: Express skeleton — static, session, error middleware

**→ Checkpoint A: Foundation**

### Phase 1 — Registration (U1, A1)
- T4: `services/crypto.js` — HMAC+salt, SHA-1 token, timing-safe compare
- T5: `services/passwordPolicy.js` + `config.json` + dictionary
- T6: Register slice — `POST /api/register`, `register.html`, `register.js`

### Phase 2 — Login and lockout (U2, U3)
- T7: Login slice — `POST /api/login`, `/logout`, `GET /api/me`, `requireAuth`, `index.html`
- T8: Lockout — attempt counter, `is_locked`, 403 path

**→ Checkpoint B: Authentication works end-to-end**

### Phase 3 — Customers (U7)
- T9: Customers slice — `POST`/`GET /api/customers`, `system.html`, `system.js` (the XSS sink)

### Phase 4 — Password change (U4, U5)
- T10: Change-password slice — current-password check, history reject, history trim

### Phase 5 — Password reset (U6)
- T11: Forgot slice — `services/mailer.js`, `POST /api/forgot`, `forgot-password.html`
- T12: Reset slice — `POST /api/reset`, expiry, unlock, `reset-password.html`

**→ Checkpoint C′: JOINT live-connection session + secure build feature-complete**

### Phase 6 — Secure hardening and regression
- T13: `secure/tests/attacks.test.js` + error-leak and SQL-interpolation checks
- T14: `db:seed`, final npm scripts, ESLint flat config

**→ Checkpoint D: Secure build is hardened and green**

### Phase 7 — Vulnerable twin
- T15: Derive `vulnerable/` from `secure/`, second database, port 3001
- T16: Reintroduce SQL injection in the three route modules
- T17: Reintroduce the stored-XSS render sink
- T18: `vulnerable/tests/attacks.test.js` + tree-drift diff check

**→ Checkpoint E: Both builds run, attacks succeed on :3001 and fail on :3000**

### Phase 8 — Evidence and delivery
- T19: `docs/attack-report.md` + screenshots
- T20: `README.md` + full §16 success-criteria sweep

**→ Checkpoint F: Ready to submit**

---

## Checkpoints

Each checkpoint is a stop-and-review gate, not a formality. Details and checkboxes live in
`tasks/todo.md`; the gates are:

| # | After | The system must demonstrably… |
|---|---|---|
| A | T3 | serve a static page and return JSON errors with no stack leakage — **no database calls exercised yet** (A2) |
| B | T8 | have register / login / lockout written with acceptance criteria expressed as runnable tests — *code complete, verification pending* |
| **C′** | **T12** | **joint session with the developer:** `npm run preflight` green, `db:init` green, then the whole deferred verification backlog runs at once — SC1–SC8 |
| D | T14 | pass `npm --prefix secure test` with the attack suite proving payloads are inert |
| E | T18 | run both builds side by side; `diff -r` shows exactly the six files from A4 |
| F | T20 | satisfy all 17 criteria in §16 |

**What can still be verified solo before C′:** anything without a database — `crypto.test.js` and
`password-policy.test.js` (pure functions over `crypto` and a JSON file), ESLint, the SC14 static
SQL check, and serving static pages. That is the continuous feedback loop while the database
verification backlog accumulates.

---

## Definition of Done

Tailored from `references/definition-of-done.md` for a two-build security coursework deliverable.
Every task clears this in addition to its own acceptance criteria.

**Correctness**
- Acceptance criteria met and verified *at runtime* — **except** for database-dependent criteria
  before Checkpoint C′, which are marked *code complete, verification pending* and carried on the
  C′ backlog (A2). "Pending" is a status, not a pass; no task is checked off on the strength of it
- New behaviour has a test that fails without the change — written *when the code is written*, even
  if it cannot be run until C′
- `npm --prefix secure test` green (and from Phase 7, `npm --prefix vulnerable test` too)
- Error paths handled, not just the happy path
- No suite calls `TRUNCATE` — fixtures are prefixed and self-deleting (A6, risk R4b)

**Security posture (project-specific — this is the coursework)**
- Every SQL statement in `secure/` uses `pool.execute(sql, params)`; no interpolation into SQL text
- Every untrusted string rendered in `secure/` uses `textContent`
- No password, hash, salt, or reset token appears in a log line, an error message, or an API response
- Any intentional flaw carries the `// !! INTENTIONALLY VULNERABLE — see SPEC.md §10 !!` banner
- No `.env`, RDS password, or Gmail app password staged for commit

**Quality**
- Matches §11 code style: CommonJS, 2-space, single quotes, `async/await`, small modules
- No dead code, no debug `console.log`, no commented-out blocks
- Scoped to the task — no drive-by refactors

**Integration**
- From Phase 7 on, non-security changes are applied to **both** trees in the same commit
- Schema changes are reflected in `db/schema.sql` and re-runnable via `npm run db:init`

**Documentation**
- Anything a marker must reproduce is written down in `README.md` or `docs/attack-report.md`
- `SPEC.md` is updated first if a decision changes — the spec is the living contract, not a relic

---

## Risks and Mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | **RDS unreachable** — security group has no rule for the dev IP, or the instance is not publicly accessible | **High**, and **discovered late by choice** (A2): surfaces at Checkpoint C′ with ~12 tasks of unverified code already written | Partially accepted. `preflight.js` makes the diagnosis one command rather than an afternoon. Every DB-dependent acceptance criterion is written as an executable test *while* the code is written, so C′ is a batch run, not a re-derivation. Fallback if RDS proves unreachable: Docker MySQL locally, `.env` pointed at RDS for the demo only |
| R1b | **Verification backlog** — a systematic error (a wrong column name, a bad pool option) repeats across every route before anything runs once | **High** — one mistake multiplies across ~12 tasks | The DB-free suites (crypto, policy) run continuously; `db/schema.sql` and `db/connection.js` are reviewed against §6 line by line at Checkpoint A; each route is written against the §8 contract, not from memory |
| R2 | **Gmail app password unavailable** (2FA not enabled on the account) | **High** — blocks SC6 | `transporter.verify()` runs in the same joint session. Mailer is written behind a one-function interface so a transport swap is a two-line change. Fallback if the account cannot be provisioned: nodemailer Ethereal, documented as a deviation |
| R3 | **Dev IP is dynamic** — home/ISP address changes and the security group rule silently goes stale | Medium | `npm run preflight` re-runs in one second and prints the current public IP alongside the failure; README documents re-adding the rule |
| R4 | **Test flakiness against a remote DB** — latency, parallel interference, connection limits | Medium | A6: `--test-concurrency=1`, pool `connectionLimit: 5`, `__test_<runId>_` prefixed fixtures scoped per suite |
| R4b | **A test destroys demo data** — a `TRUNCATE` wipes the demo user and customers because tests share the tree's database (A6) | Medium — discovered at demo time, which is the worst time | `TRUNCATE` is banned in `tasks/plan.md` DoD and grep-checked at Checkpoint D; suites delete only rows matching their own run prefix; `npm run db:seed` restores the demo user in seconds |
| R5 | **Tree drift** — a bug fixed in `secure/` and forgotten in `vulnerable/`, or vice versa | Medium — silently invalidates the "only two differences" claim that the whole report rests on | A4: the `diff -r` check is a checkpoint gate, run before every commit after Phase 7 |
| R6 | **The vulnerable build is accidentally *not* vulnerable** — e.g. `mysql2` escaping or a stray `execute()` neutralises the payload | Medium — the deliverable's evidence evaporates | T18's suite asserts the attacks **succeed**; a green secure suite and a green vulnerable suite together are the proof. `multipleStatements: false` in both, so the demo relies on `OR '1'='1'` and `UNION`, never on stacked queries |
| R7 | **SQLi demo corrupts the demo database** mid-presentation (`DROP`, `UPDATE`) | Medium | §3's two-database split; plus `npm run db:init` in `vulnerable/` restores a clean slate in seconds |
| R8 | **`is_locked` is permanent (D4)** and a developer locks themselves out during manual testing | Low | `npm run db:seed` resets the demo user; the forgot-password flow is the in-app path, which is also the U6 demo |
| R9 | **Windows/Git Bash line endings** in `schema.sql` or `common-passwords.txt` breaking a naive parser | Low | `db:init` splits on `;` after normalising `\r\n`; dictionary reader trims each line |
| R10 | **Session `regenerate()` under supertest** — the cookie changes on login and a naive test agent loses it | Low | Use `supertest.agent()` per suite, which follows the `Set-Cookie` rotation |

---

## Open Questions

Carried from §17. Nothing here blocks writing code any more — **Q1 and Q2 are needed for the joint
Checkpoint C′ session**, and everything else has a working default.

1. **RDS credentials (needed at C′).** `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`. Do
   `comm_ltd_secure` and `comm_ltd_vulnerable` already exist on the instance, or should
   `scripts/init-db.js` issue `CREATE DATABASE IF NOT EXISTS` (which requires the master user)?
   **Assumed if unanswered:** `init-db.js` creates them.
2. **Gmail account (needed at C′).** Which address sends *and* receives during the demo, and is 2FA
   enabled so an app password can be generated?
3. **ESLint** — planned into T14 as a devDependency with a minimal flat config. Say the word and
   T14 drops it and the two lint scripts.
4. **CSRF token** — not required by the brief. **Assumed:** omitted, and listed as future work in
   `docs/attack-report.md`. Say so and it becomes a task in Phase 6.
5. **Dictionary size** — `data/common-passwords.txt` ships with ~1,000 entries. **Assumed:** enough.
6. **Customer fields** — name, email, phone, sector, package. **Assumed:** sufficient; a `packages`
   lookup table would add a task to Phase 3.
7. **Report language** — English or Hebrew for `docs/attack-report.md`? **Assumed:** English.

---

## Parallelization Notes

Single-developer sequential execution is assumed. If work is split:

- **Safe to parallelize:** T4 ‖ T5 ‖ (T1→T3); T9 ‖ T10; T19 ‖ T20
- **Must be sequential:** T2→T3 (pool before server), T6→T7→T8 (same route module), T10→T11→T12
  (reset reuses the history logic from change-password), all of Phase 7 after all of Phase 6
- **Needs coordination:** the §8 API contract is frozen before Phase 1 begins — client JS and tests
  both bind to it, so a shape change late in the plan invalidates work in three places
