const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const router = express.Router();

const SESSION_DAYS = 30;

module.exports = function createAuth(db) {

  // Generate a secure random session token
  function createToken() {
    return crypto.randomBytes(32).toString("hex");
  }

  // Clean expired sessions
  function cleanSessions() {
    db.prepare("DELETE FROM sessions WHERE expires < datetime('now')").run();
  }

  // ---- AUTH MIDDLEWARE ----
  // Attach to all /api routes — checks for valid session cookie
  function requireAuth(req, res, next) {
    // Allow auth routes through
    if (req.path === "/auth/login" || req.path === "/auth/setup" || req.path === "/auth/status") {
      return next();
    }

    const token = req.cookies?.gc_session;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    cleanSessions();
    const session = db.prepare(
      "SELECT s.*, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > datetime('now')"
    ).get(token);

    if (!session) {
      res.clearCookie("gc_session");
      return res.status(401).json({ error: "Session expired" });
    }

    req.user = { id: session.user_id, username: session.username, role: session.role };
    next();
  }

  // ---- ROUTES ----

  // Check if setup is needed (no users yet) + current auth status
  router.get("/auth/status", (req, res) => {
    const userCount = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
    const needsSetup = userCount === 0;

    const token = req.cookies?.gc_session;
    let user = null;
    if (token) {
      const session = db.prepare(
        "SELECT s.*, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > datetime('now')"
      ).get(token);
      if (session) user = { username: session.username, role: session.role };
    }

    res.json({ needsSetup, authenticated: !!user, user });
  });

  // First-time setup — create admin account
  router.post("/auth/setup", (req, res) => {
    const userCount = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
    if (userCount > 0) return res.status(400).json({ error: "Setup already completed" });

    const { username, password } = req.body;
    if (!username?.trim() || !password) return res.status(400).json({ error: "Username and password required" });
    if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });

    const hash = bcrypt.hashSync(password, 12);
    const result = db.prepare(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')"
    ).run(username.trim(), hash);

    // Auto-login after setup
    const token = createToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    db.prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)").run(token, result.lastInsertRowid, expires);

    res.cookie("gc_session", token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_DAYS * 86400000,
      secure: process.env.NODE_ENV === "production",
    });

    res.json({ success: true, user: { username: username.trim(), role: "admin" } });
  });

  // Login
  router.post("/auth/login", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });

    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username.trim());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = createToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    db.prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)").run(token, user.id, expires);

    res.cookie("gc_session", token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_DAYS * 86400000,
      secure: process.env.NODE_ENV === "production",
    });

    res.json({ success: true, user: { username: user.username, role: user.role } });
  });

  // Logout
  router.post("/auth/logout", (req, res) => {
    const token = req.cookies?.gc_session;
    if (token) {
      db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    }
    res.clearCookie("gc_session");
    res.json({ success: true });
  });

  // Change password (authenticated)
  router.post("/auth/change-password", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both passwords required" });
    if (newPassword.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const hash = bcrypt.hashSync(newPassword, 12);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, req.user.id);

    // Invalidate all other sessions
    const token = req.cookies?.gc_session;
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(req.user.id, token);

    res.json({ success: true });
  });

  // Add user (admin only)
  router.post("/auth/add-user", (req, res) => {
    if (!req.user || req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
    const { username, password, role } = req.body;
    if (!username?.trim() || !password) return res.status(400).json({ error: "Username and password required" });
    if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });

    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username.trim());
    if (existing) return res.status(400).json({ error: "Username already exists" });

    const hash = bcrypt.hashSync(password, 12);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run(username.trim(), hash, role || "user");

    res.json({ success: true });
  });

  return { router, requireAuth };
};
