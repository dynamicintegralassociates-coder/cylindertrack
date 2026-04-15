# VOLUME MIGRATION RUNBOOK — READ BEFORE DEPLOYING

**Status:** Your production CylinderTrack is running without a
persistent Railway volume. The SQLite database lives on ephemeral
disk and will be wiped on the next Railway redeploy.

**Goal:** Get prod onto a persistent volume without losing any data.

**Time required:** ~30 minutes of careful work.

**Do not skip steps. Do not reorder steps. Do not do this at the
end of a long day.**

---

## Pre-flight checklist (before you start)

- [ ] It is **not** month-end, end-of-day, or the middle of a
      billing run
- [ ] You have at least 45 minutes of uninterrupted time
- [ ] You are on a stable internet connection
- [ ] You know your production Railway URL
- [ ] You know your admin username and password
- [ ] You have a USB stick OR OneDrive folder OR Google Drive folder
      ready to receive the backup file (you'll need TWO copies in
      TWO places)
- [ ] If you have a support person or colleague who could call
      customers to apologize in the worst case, give them a heads-up

---

## Phase 1 — Deploy the new code to dev first (10 min)

1. Extract `cylindertrack-backup-and-audit.zip` into your local
   project directory, overwriting the existing files.

2. Open a terminal in the project directory and run:
   ```
   node test_backup.js
   ```
   It should end with `[done] ALL TESTS PASSED`. If it doesn't,
   **STOP** and message me. Do not proceed.

3. Also run:
   ```
   node test_audit.js
   ```
   Also should end with `ALL TESTS PASSED`.

4. Commit to your dev branch:
   ```
   git checkout dev
   git add .
   git commit -m "Add full backup/restore (step 4)"
   git push origin dev
   ```

5. Railway auto-deploys the dev service. Wait for the build to
   finish (~2 min), watch the logs, make sure it starts cleanly.

6. Open your dev URL, log in, go to Administrator page. Scroll
   down — you should see a new "Backup & Restore" section with:
   - Row count grid showing all the tables
   - A green "Download Full Backup" button
   - A file upload for restore

7. Click "Download Full Backup" on DEV first. It should download
   a file named something like
   `cylindertrack-full-backup-2026-04-15T10-30-00.json`.

8. Open the file in a text editor. It should be several KB to
   several MB. It should start with
   `{ "format": "cylindertrack-full-backup", "format_version": 1, ...`
   and contain recognizable customer names, order numbers, etc.

9. If the dev backup looks good, proceed to phase 2. If anything
   looks wrong, STOP and message me.

---

## Phase 2 — Deploy to production (5 min)

**Data on prod is still live at this point. We are deploying code
that adds new features but does not touch the storage layer yet.**

1. Merge dev into main:
   ```
   git checkout main
   git merge dev
   git push origin main
   ```

2. Railway auto-deploys prod. Watch the logs for clean startup.
   **CRITICAL: confirm the app started and data is still there.**
   Log in, check you can see customers, check the audit log has
   recent entries from your usual work.

3. If prod started up and data is still intact, proceed to phase 3.

   If data is MISSING after this deploy, **STOP**. Do not touch
   anything else. Message me immediately with:
   - What you see on the login screen
   - The output of `railway logs` or the Railway dashboard logs tab
   - Whether you had previously downloaded a backup today

---

## Phase 3 — Take the backup (5 min)

**THIS IS THE MOST IMPORTANT STEP. DO NOT SKIP. DO NOT RUSH.**

1. Log into production CylinderTrack as admin.

2. Go to Administrator page. Scroll to "Backup & Restore".

3. Look at the row count grid. Take a screenshot or write down
   the counts for the critical tables:
   - `customers`: _______
   - `orders`: _______
   - `order_lines`: _______
   - `invoices`: _______
   - `payments`: _______
   - `transactions`: _______
   - `audit_log`: _______

4. Click "Download Full Backup". Wait for the download to finish.

5. Find the downloaded file. Name it something memorable:
   `cylindertrack-backup-PRE-VOLUME-MIGRATION-YYYYMMDD.json`

6. **Verify the backup is real:**
   - Open it in a text editor
   - It should be AT LEAST several hundred KB (probably larger)
   - Search for a customer name you know by heart
   - Search for an order number you recognize
   - Check the `row_counts` section matches what you screenshotted
     in step 3

7. **Make a second copy in a second location.** Do not proceed
   until you have two copies in two places. Options:
   - Copy to USB stick AND OneDrive
   - Copy to OneDrive AND Google Drive
   - Copy to OneDrive AND email to yourself
   - (whatever works, just TWO places)

8. One more check: try opening the JSON file in a browser. If it
   renders as structured JSON without errors, the file is valid.

9. If you have ANY doubt about the backup, STOP and message me
   before continuing. There is no shame in double-checking.

---

## Phase 4 — Attach the Railway volume (5 min)

**Only proceed if phase 3 completed with TWO verified copies of
the backup.**

1. Open Railway → your CylinderTrack project → production
   CylinderTrack service → Settings tab.

2. Scroll to Volumes section → click "+ New Volume" (or similar).

3. Configure:
   - **Mount Path:** `/data`
   - **Size:** `1 GB`
   - **Name:** `cylindertrack-data` (or whatever)

4. Save the volume. Railway will flag that a redeploy is needed
   but **do not redeploy yet.**

5. Go to the Variables tab on the same service.

6. Add a new variable:
   - **Key:** `DB_DIR`
   - **Value:** `/data`

7. Save. This will trigger an automatic redeploy.

8. **This is the moment the ephemeral disk gets wiped.** Watch
   the deploy logs. The app will start, see an empty `/data`
   directory, and create a fresh empty database.

9. When the deploy finishes, open your prod URL. You will see
   the **first-time setup screen** asking you to create an admin
   user. This is expected — the new DB is empty.

10. **Create a TEMPORARY admin user** with some username like
    `restore-temp` and any password. This is only so you can log
    in to run the restore. We will overwrite this account when
    we restore from the backup.

---

## Phase 5 — Restore from backup (5 min)

1. Log in as the temporary admin user you just created.

2. Go to Administrator page → Backup & Restore section.

3. Check the row counts — they should all be near-zero
   (probably `users: 1`, `settings: 15`, everything else 0).

4. Click the file upload field under "Restore from backup".

5. Select the backup file from phase 3.

6. A validation panel will appear showing:
   - ✓ Backup file is valid
   - Format: cylindertrack-full-backup
   - Exported: (the timestamp from phase 3)
   - Total rows: (the number from phase 3)
   - Row breakdown

7. **Verify this matches what you screenshotted in phase 3 step 3.**
   If the numbers are different, STOP and check you uploaded the
   right file.

8. Click the red "Restore from this backup (DESTRUCTIVE)" button.

9. A confirmation dialog appears. Read it. Click OK.

10. A second prompt asks you to type `RESTORE`. Type it exactly
    (all caps). Click OK.

11. Wait for the restore to complete. You'll see a green banner:
    "Restore complete. N rows restored across M tables."

12. **You will be logged out** (because your temporary admin user
    was wiped when the users table was replaced).

---

## Phase 6 — Verify restore (5 min)

1. Log back in using your **real** admin credentials from before
   the migration.

2. If you can log in: good. If you can't, you either typed your
   password wrong or something is very wrong. Try password reset
   via `fix-admin.js` if needed.

3. Go to Administrator → Backup & Restore → refresh row counts.

4. **Compare the row counts to what you screenshotted in phase 3
   step 3.** They should match exactly (within a row or two for
   `sessions` since that's not restored, and possibly `audit_log`
   because the restore itself adds a few entries).

5. Do a visual sanity check:
   - Go to Customers — are they all there?
   - Go to Orders — are recent orders visible?
   - Go to Invoices — do totals look right?
   - Go to Audit Log — can you see entries from before the
     migration AND the new entries about the restore itself?

6. **If everything looks right, you're done with the critical
   migration.** The data is now on a persistent volume and will
   survive future redeploys.

---

## Phase 7 — Protect yourself going forward

Now that you have a working backup system, build a habit:

1. **Before every code deploy**, download a backup first. Takes
   30 seconds, saves you from any deploy-related disaster.

2. **Weekly**, download a backup and keep it somewhere not on
   your laptop (USB, OneDrive, etc.). Keep at least 4 weeks of
   weekly backups.

3. **Monthly**, verify you can actually open a backup file and
   see recognizable data. A backup you can't read is not a backup.

4. **Do not share backup files.** They contain everything
   sensitive about your business — customer details, encrypted
   card data, password hashes, the entire audit trail.

5. **Next compliance step** is automated off-Railway backup (a
   scheduled daily dump to S3 or Backblaze). That's a separate
   build and we'll do it before moving to Stripe.

---

## If something goes wrong during migration

**If phase 2 fails (new code breaks prod):**
- Roll back in git: `git revert HEAD && git push`
- Railway will redeploy the previous version
- Data on the ephemeral disk is still there as long as the
  container didn't restart for another reason

**If phase 3 fails (backup download fails):**
- Try from a different browser
- Try on a laptop if you're on a phone or vice versa
- Check browser dev console for errors
- Worst case, use `railway run` to shell into the container
  and download the db file directly — message me if you need
  this, it's complicated

**If phase 4 fails (volume attach doesn't trigger wipe, or app
won't start after wipe):**
- Check Railway logs for startup errors
- Confirm `DB_DIR=/data` is set in Variables tab
- Confirm the volume is mounted at `/data` in Volumes tab

**If phase 5 fails (restore fails):**
- The error will be displayed in the UI
- The database will be in an inconsistent state
- Delete the temporary admin user's session
- Re-upload the backup file and try again
- If it still fails, the transaction rolled back — the database
  is back to its previous state (which is empty in this case)
- Message me with the exact error text

**If phase 6 fails (row counts don't match):**
- Don't panic. The original backup file is still on your disk.
- Compare counts table by table to figure out what's missing.
- If it's a small discrepancy in `audit_log` only, that's
  expected (the restore adds a few entries).
- Anything more than that, message me.

**Nuclear option:** if everything goes wrong and prod is broken,
you still have the backup file. Even if Railway is completely
unresponsive, you can set up a fresh CylinderTrack instance
anywhere (a new Railway project, a DigitalOcean droplet, your
laptop), start it fresh, and restore from the backup file. The
backup is independent of Railway.
