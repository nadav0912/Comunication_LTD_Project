# Screenshots — capture guide

The `docs/attack-report.md` references seven screenshots. Capture them here with these exact steps.
Run both apps first:

```
npm --prefix secure start        # :3000
npm --prefix vulnerable start     # :3001
npm --prefix secure run db:seed          # optional demo user: demo / Comm7#Ltdxyz
npm --prefix vulnerable run db:seed
```

Log in on each build (register a user, or use the seeded `demo` / `Comm7#Ltdxyz`).

| File | How to capture |
|---|---|
| `01-sqli-login-3001-success.png` | On **:3001** login page, enter username `' OR '1'='1'#` and password `anything` → submit. Capture the successful landing on the system page (or the 200 in devtools → Network). *(Use the `#` comment in the browser: the login page trims the username, which strips the trailing space that the `-- ` variant needs. `#` needs no space.)* |
| `02-sqli-login-3000-fail.png` | Same payload on **:3000** → capture the "Incorrect password / User does not exist" error (login refused). |
| `03-sqli-union-3001-leak.png` | On **:3001** system page, in the customer **Search** box paste `' UNION SELECT id, username, password_hash, salt, 1, 1, 1, NOW() FROM users #` → Search. Capture the list now showing usernames + 64-hex password_hash values. (Or capture devtools → Network → the `/api/customers?search=…` JSON response.) *(Same reason as #1: the search box trims, so end the payload with `#`, not `-- `.)* |
| `04-sqli-union-3000-safe.png` | Same search on **:3000** → capture the empty/normal result (no user data). |
| `05-xss-3001-alert.png` | On **:3001** system page, add a customer named `<img src=x onerror="alert(document.cookie)">` → capture the `alert` dialog that pops on submit. |
| `06-xss-3001-persist.png` | Still on **:3001**: **log out**, log back in, land on the system page → capture the `alert` firing again on load (proves it is stored). |
| `07-xss-3000-inert.png` | On **:3000**, add the same `<img …>` customer → capture it rendered as **literal grey text** in the list, with no alert. |

Tips:
- Windows: `Win+Shift+S` (Snip & Sketch) to grab a region.
- For the JSON-response shots, Chrome DevTools → Network → click the request → Preview/Response tab.
- Keep both browser windows visible side by side where it helps the contrast.
