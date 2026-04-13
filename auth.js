const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const express = require("express");

const uid = () => crypto.randomBytes(16).toString("hex");

module.exports = function createAuth(db) {
  const router = express.Router();

  // Check if any users exist (for initial setup)
  router.get("/auth/status", (req, res) => {
    const count = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
    const token = req.cookies?.ct_session;
    let user = null;
    if (token) {
      const session = db.prepare("SELECT s.*, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?").get(token);
      if (session) user = { username: session.username, role: session.role };
    }
    res.json({ needsSetup: count === 0, user });
  });

  // Initial setup (create first admin)
  router.post("/auth/setup", (req, res) => {
    const count = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
    if (count > 0) return res.status(400).json({ error: "Setup already completed" });
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });
    if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });
    const id = uid();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, 'admin')").run(id, username.trim().toLowerCase(), hash);
    const token = uid();
    db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, id);
    res.cookie("ct_session", token, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, user: { username: username.trim().toLowerCase(), role: "admin" } });
  });

  // Login
  router.post("/auth/login", (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }
      const user = db.prepare("SELECT * FROM users WHERE username = ?").get(String(username).trim().toLowerCase());
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      // bcrypt.compareSync can throw on corrupt hashes — guard it explicitly
      let ok = false;
      try {
        ok = bcrypt.compareSync(String(password), user.password || "");
      } catch (cmpErr) {
        console.error("[auth/login] bcrypt compare threw for user", user.username, cmpErr.message);
        return res.status(500).json({ error: "Authentication error — password hash may be corrupt. Run fix-admin.js to reset." });
      }
      if (!ok) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const token = uid();
      db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, user.id);
      res.cookie("ct_session", token, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000 });
      res.json({ success: true, user: { username: user.username, role: user.role } });
    } catch (err) {
      console.error("[auth/login] EXCEPTION:", err);
      console.error("[auth/login] Stack:", err.stack);
      return res.status(500).json({
        error: err.message || "Internal server error during login",
        details: err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : null,
      });
    }
  });

  // Logout
  router.post("/auth/logout", (req, res) => {
    const token = req.cookies?.ct_session;
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    res.clearCookie("ct_session");
    res.json({ success: true });
  });

  // Add user (admin only)
  router.post("/auth/add-user", requireAuth(db), (req, res) => {
    const token = req.cookies?.ct_session;
    const session = db.prepare("SELECT u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?").get(token);
    if (session?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username.trim().toLowerCase());
    if (existing) return res.status(400).json({ error: "Username already exists" });
    const id = uid();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)").run(id, username.trim().toLowerCase(), hash, role || "user");
    res.json({ success: true });
  });

  // Change password
  router.post("/auth/change-password", requireAuth(db), (req, res) => {
    const token = req.cookies?.ct_session;
    const session = db.prepare("SELECT s.user_id, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?").get(token);
    const { userId, newPassword } = req.body;
    const targetId = userId || session.user_id;
    if (targetId !== session.user_id && session.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });
    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hash, targetId);
    res.json({ success: true });
  });

  // List users (admin only)
  router.get("/auth/users", requireAuth(db), (req, res) => {
    const users = db.prepare("SELECT id, username, role, created FROM users ORDER BY created").all();
    res.json(users);
  });

  return router;
};

function requireAuth(db) {
  return (req, res, next) => {
    const token = req.cookies?.ct_session;
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    const session = db.prepare("SELECT s.*, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?").get(token);
    if (!session) return res.status(401).json({ error: "Invalid session" });
    req.user = { id: session.user_id, username: session.username, role: session.role };
    next();
  };
}

module.exports.requireAuth = function(db) {
  return (req, res, next) => {
    const token = req.cookies?.ct_session;
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    const session = db.prepare("SELECT s.*, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?").get(token);
    if (!session) return res.status(401).json({ error: "Invalid session" });
    req.user = { id: session.user_id, username: session.username, role: session.role };
    next();
  };
};