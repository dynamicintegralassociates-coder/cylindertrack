const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const { initDB } = require("./db");
const createRoutes = require("./routes");
const createAuth = require("./auth");

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize database
const db = initDB();

// Auth setup
const { router: authRouter, requireAuth } = createAuth(db);

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());

// Auth routes (login, setup, status — no auth required on these)
app.use("/api", authRouter);

// Auth middleware — all /api routes below this require a valid session
app.use("/api", requireAuth);

// Protected API routes
app.use("/api", createRoutes(db));

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
  console.log(`  ║   CylinderTrack API Server           ║`);
  console.log(`  ║   http://localhost:${PORT}              ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});
