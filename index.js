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
