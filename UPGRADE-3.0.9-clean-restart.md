# CylinderTrack 3.0.9 — clean restart bundle

This is every code file in the project, all at version 3.0.9. Use this
when you want a known-good baseline and don't want to remember which
files were updated in which round.

## What's in here

**14 files. Copy ALL of them.** If you skip any, you risk a partial
upgrade and another evening of debugging.

Backend (these go in your project root, alongside `cylindertrack.db`):
- `db.js`
- `routes.js`
- `index.js`
- `optimoroute.js`
- `email.js`
- `auth.js`
- `crypto.js`
- `fix-admin.js`
- `package.json`

Frontend (these go in `client/src/` — wherever your existing App.jsx
currently lives):
- `App.jsx`
- `api.js`
- `main.jsx`

Frontend root (these go in `client/`):
- `index.html`
- `vite_config.js` ← rename to `vite.config.js` if your project uses
  the dotted name. Whatever your existing one is called, replace it
  with this content.

## Step-by-step deploy

### 1. Stop everything

In a Windows command prompt (NOT a node terminal — a fresh `cmd` window):

```
taskkill /F /IM node.exe
```

This kills every Node process. If you have other Node things running
on this machine you care about, kill them more selectively. Otherwise
this is the safe nuke.

Then close any Visual Studio Code windows that have CylinderTrack
terminals open. You want a completely clean slate.

### 2. Backup your database

```
cd C:\Users\marsh\Downloads\cylindertrack
copy cylindertrack.db cylindertrack-pre-3.0.9.bak.db
```

(Or wherever your project lives. Adjust the path.)

If you skip this and something goes wrong, your test data is gone.
**Do not skip.**

### 3. Copy the files

Open the folder where you downloaded this bundle. Copy each file to
its destination:

| File from bundle | Goes to |
|---|---|
| `db.js` | project root |
| `routes.js` | project root |
| `index.js` | project root |
| `optimoroute.js` | project root |
| `email.js` | project root |
| `auth.js` | project root |
| `crypto.js` | project root |
| `fix-admin.js` | project root |
| `package.json` | project root |
| `App.jsx` | `client/src/` (overwrites existing) |
| `api.js` | `client/src/` (overwrites existing) |
| `main.jsx` | `client/src/` (overwrites existing) |
| `index.html` | `client/` (overwrites existing) |
| `vite_config.js` | `client/` — rename to whatever your existing vite config file is called (probably `vite.config.js`) |

If your folder structure doesn't have a `client/` subfolder, all the
frontend files go alongside the backend files in the root. If you're
unsure, check where your existing `App.jsx` is right now and put the
new `App.jsx` in the same place.

### 4. Reinstall packages (just to be safe)

In your project root:
```
npm install
```

If you have a `client` subfolder:
```
cd client
npm install
cd ..
```

This makes sure no dependencies are missing. Should be fast — nothing
new added in 3.0.9.

### 5. Rebuild the frontend

```
cd client
npm run build
cd ..
```

(If you don't have a `client` subfolder, just `npm run build` in the
root.)

This compiles the new App.jsx into the assets your server will serve.
**Critical step. Skipping this means your browser keeps loading the
old App.jsx no matter how many times you refresh.**

### 6. Start the backend in a fresh terminal

Open a brand new terminal window. Don't reuse an old one — fresh.

```
cd C:\Users\marsh\Downloads\cylindertrack
node index.js
```

You should see:

```
╔══════════════════════════════════════╗
║   CylinderTrack API Server v3.0.9    ║
║                                      ║
║   http://localhost:3001              ║
╚══════════════════════════════════════╝
```

If the version number is anything other than **3.0.9**, you copied
the wrong files or copied to the wrong location. Stop and double-check
step 3 before continuing.

If there are red errors before the banner, paste them to me. Don't
proceed until the banner appears clean.

### 7. Start the frontend dev server in ANOTHER fresh terminal

Open a second terminal window (leave the backend one running and
visible).

```
cd C:\Users\marsh\Downloads\cylindertrack\client
npm run dev
```

You should see Vite say something like:

```
  VITE v4.5.0  ready in 387 ms
  ➜  Local:   http://localhost:5173/
```

If it says 5174 or any other port, that means another Vite was already
running. Go back to step 1 and kill all node processes more
aggressively, then start over.

### 8. Open the app in a fresh browser tab

Close any existing CylinderTrack tabs in your browser. Open a new tab.
Navigate to `http://localhost:5173/`.

Press **Ctrl+Shift+R** to hard-refresh (this bypasses any cached
JavaScript from before the upgrade).

Log in. You should see the main interface looking the same as before.

### 9. Verify the upgrade actually took

Three things to check:

**a) Boot banner is 3.0.9** — Look at the backend terminal. The banner
should clearly say `v3.0.9`.

**b) Order line autocomplete works** — Open Orders → New Order. Pick a
customer. Type in the order detail field. Suggestions should appear
as you type (like "1x45" → 45kg cylinder match).

**c) GST labels visible** — Open Billing. The grand total cards at the
top should say "(inc GST)" in their labels.

If all three pass, you're on a clean 3.0.9. If any fail, paste me which
one failed and what you see.

### 10. Try creating a test order

This is the actual end-to-end test. Create a fresh order with at least
one cylinder line. Don't tick "Paid in Full". Click Save.

**If it works** — you'll see a green toast "Order created (status:
open)" or similar. The order will appear in the list. **Then we're
golden, reply with "order created OK".**

**If it fails** — you'll see a red toast with an actual error message
(thanks to the try/catch wrappers in 3.0.8 and 3.0.9). **Paste me the
exact text of the toast.** Don't paraphrase — copy it verbatim.

## Things you don't need to do

- You don't need to manually run any database migration. The
  migrations run automatically on first boot of 3.0.9 and they're
  idempotent (safe to re-run on every boot).
- You don't need to delete `node_modules` unless something is really
  broken. `npm install` is enough.
- You don't need to modify the database manually.
- You don't need to update environment variables — none changed.

## If something goes wrong

1. **"Cannot find module" on startup** — you missed copying a file.
   Recheck step 3.
2. **"SQLITE_ERROR: no such column"** — db.js didn't deploy or the
   server didn't restart cleanly. Re-copy db.js and restart.
3. **Backend boots but frontend shows blank page** — you didn't rebuild
   the frontend in step 5, or the build failed silently. Check the
   client terminal for build errors.
4. **Backend boots, frontend loads, but every API call returns 401** —
   your session cookie is from the old version. Log out and back in.
5. **Backend boots but says some other version (not 3.0.9)** — Visual
   Studio's deploy is writing to a different folder than the one your
   `node index.js` command is running from. Check the actual file
   modified date in the folder where you ran `node index.js`.

## What this bundle contains compared to your 2.7.0

Everything from rounds 3.0.0 through 3.0.9 consolidated:

- Round 3 7-state order lifecycle (open → awaiting_dispatch → dispatched
  → delivered → invoiced → paid → cancelled)
- Multi-line orders with the order_lines table
- Pending invoices, prepaid_until tracking, auto-close stale orders
- Auto-push to Optimo (configurable per residential/commercial)
- Manual deliver/cancel of individual lines
- Record Payment button in BillingView invoice modal
- Net storage / gross display with "(inc GST)" labels
- Defensive guards: payment-amount-decrease refusal, orphan invoice ID
  detection in generateInvoiceForOrder
- Debug endpoints: customer-snapshot, integrity-scan-all,
  customer-invoice-integrity, repair-customer-invoices, recalc-balance,
  orphans
- Bulletproof lookup-price routing (both correctly ordered AND inline
  fallback in /orders/:id)
- try/catch wrappers on POST /orders and PUT /orders so errors return
  real messages instead of "Internal Server Error"
- Diagnostic logging on POST/PUT /orders (will be removed in 3.0.10
  once we're confident the upgrade is solid)

## After 3.0.9 is verified working

Reply with "order created OK" or paste me whatever error you see.

Once we confirm 3.0.9 is solid, we can finally start working through
the wave 2 issues from your spreadsheet:
- Customer panel showing all orders instead of selected customer's
- Cannot edit unit prices on existing order lines
- Credit note approval doesn't update balance
- Manual deliver/return doesn't update on-hand
- Rental history empty
- Pricing manager regression
- Edit delivered order shows Save & Sync button
- And the rest of the wave 2/3/4 list

These have all been deferred until we verify the round 3 backbone is
working on real data. After 3.0.9 works, we'll knock them out one or
two per release.
