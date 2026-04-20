const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const { initDB } = require("./db");
const createRoutes = require("./routes");
const { runDueRentals, runAutoCloseOrders } = require("./routes");
const createAuth = require("./auth");
const { requireAuth } = require("./auth");

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize database
const db = initDB();

// ── Recovery: if RECOVERY_PASSWORD is set, reset (or create) the admin account ──
// Set this env var in Railway, deploy once to regain access, then remove it.
if (process.env.RECOVERY_PASSWORD) {
  try {
    const bcrypt = require("bcryptjs");
    const crypto = require("crypto");
    const hash = bcrypt.hashSync(process.env.RECOVERY_PASSWORD, 10);
    const existing = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY rowid LIMIT 1").get();
    if (existing) {
      db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hash, existing.id);
      const uname = db.prepare("SELECT username FROM users WHERE id = ?").get(existing.id).username;
      console.log(`[recovery] Admin password reset for user: ${uname}`);
    } else {
      const id = crypto.randomBytes(16).toString("hex");
      db.prepare("INSERT INTO users (id, username, password, role) VALUES (?, 'admin', ?, 'admin')").run(id, hash);
      console.log("[recovery] No admin found — created user: admin");
    }
  } catch (e) {
    console.error("[recovery] Failed:", e.message);
  }
}

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

// Auth routes (public)
app.use("/api", createAuth(db));

// Protected API routes
app.use("/api", requireAuth(db), createRoutes(db));

// Serve static frontend in production
const clientBuild = path.join(__dirname, "client/dist");
app.use(express.static(clientBuild));
app.get("*", (req, res) => {
  if (!req.path.startsWith("/api")) {
    res.sendFile(path.join(clientBuild, "index.html"));
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  if (rentalTimer) clearInterval(rentalTimer);
  db.close();
  process.exit(0);
});

// ============================================================
// RENTAL CYCLE SCHEDULER + AUTO-CLOSE ORDERS
// Runs both jobs once on boot, then every 6 hours.
// Both are safe to call repeatedly.
// ============================================================
let rentalTimer = null;
const RENTAL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

function scheduledRentalRun() {
  try {
    const result = runDueRentals(db);
    if (result.customersBilled > 0 || result.invoicesCreated > 0) {
      console.log(`[rentals] billed ${result.customersBilled} customer(s), created ${result.invoicesCreated} invoice line(s) at ${result.ranAt}`);
    }
    if (result.errors && result.errors.length) {
      console.error(`[rentals] ${result.errors.length} error(s):`, result.errors);
    }
  } catch (err) {
    console.error("[rentals] scheduler crashed:", err);
  }

  // Round 3: also run the auto-close pass for stale dispatched orders
  try {
    const r = runAutoCloseOrders(db);
    if (r.closed > 0) {
      console.log(`[auto-close] closed ${r.closed} stale dispatched order(s) at ${r.ranAt}`);
    }
    if (r.errors && r.errors.length) {
      console.error(`[auto-close] ${r.errors.length} error(s):`, r.errors);
    }
  } catch (err) {
    console.error("[auto-close] crashed:", err);
  }
}

// First run shortly after boot, then every 6 hours
setTimeout(scheduledRentalRun, 30 * 1000);
rentalTimer = setInterval(scheduledRentalRun, RENTAL_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║   CylinderTrack API Server v3.0.18   ║`);
  console.log(`  ║   + OptimoRoute Integration          ║`);
  console.log(`  ║   + Rental Cycle Scheduler           ║`);
  console.log(`  ║   + Invoices, Credits & Balances     ║`);
  console.log(`  ║   http://localhost:${PORT}              ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});
