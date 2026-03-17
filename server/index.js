const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const { initDB } = require("./db");
const createRoutes = require("./routes");
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
const clientBuild = path.join(__dirname, "../client/dist");
app.use(express.static(clientBuild));
app.get("*", (req, res) => {
  if (!req.path.startsWith("/api")) {
    res.sendFile(path.join(clientBuild, "index.html"));
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  db.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║   CylinderTrack API Server v2.1      ║`);
  console.log(`  ║   + OptimoRoute Integration          ║`);
  console.log(`  ║   http://localhost:${PORT}              ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});
