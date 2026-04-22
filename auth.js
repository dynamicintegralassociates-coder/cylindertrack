const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const express = require("express");
const { logAudit } = require("./audit");

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
    // Synthesize req.user for the audit call (we just created the user).
    const auditReq = { ...req, user: { id, username: username.trim().toLowerCase(), role: "admin" } };
    logAudit(db, auditReq, {
      action: "setup",
      table: "users",
      record_id: id,
      after: { id, username: username.trim().toLowerCase(), role: "admin" },
      summary: `Initial admin user created: ${username.trim().toLowerCase()}`,
    });
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
        logAudit(db, req, {
          action: "login_failed",
          table: "users",
          record_id: "",
          summary: `Failed login — unknown username: ${String(username).trim().toLowerCase()}`,
        });
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
        logAudit(db, req, {
          action: "login_failed",
          table: "users",
          record_id: user.id,
          summary: `Failed login — bad password for ${user.username}`,
        });
        return res.status(401).json({ error: "Invalid credentials" });
      }
      if (user.active === 0) {
        return res.status(403).json({ error: "This account has been deactivated. Contact your administrator." });
      }
      const token = uid();
      db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, user.id);
      logAudit(db, { ...req, user: { id: user.id, username: user.username, role: user.role } }, {
        action: "login",
        table: "users",
        record_id: user.id,
        summary: `Login success: ${user.username} (${user.role})`,
      });
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
    if (token) {
      const session = db.prepare("SELECT s.user_id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?").get(token);
      if (session) {
        logAudit(db, { ...req, user: { id: session.user_id, username: session.username, role: session.role } }, {
          action: "logout",
          table: "users",
          record_id: session.user_id,
          summary: `Logout: ${session.username}`,
        });
      }
      db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    }
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
    logAudit(db, req, {
      action: "create",
      table: "users",
      record_id: id,
      after: { id, username: username.trim().toLowerCase(), role: role || "user" },
      summary: `Admin created user: ${username.trim().toLowerCase()} (${role || "user"})`,
    });
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
    const targetUser = db.prepare("SELECT username, role FROM users WHERE id = ?").get(targetId);
    logAudit(db, req, {
      action: "password_change",
      table: "users",
      record_id: targetId,
      summary: targetId === session.user_id
        ? `User changed own password: ${targetUser?.username || targetId}`
        : `Admin reset password for: ${targetUser?.username || targetId}`,
    });
    res.json({ success: true });
  });

  // List users (admin only)
  router.get("/auth/users", requireAuth(db), (req, res) => {
    const users = db.prepare("SELECT id, username, role, active, created FROM users ORDER BY created").all();
    res.json(users);
  });

  // Update user — change username and/or role (admin only)
  router.put("/auth/users/:id", requireAuth(db), (req, res) => {
    const token = req.cookies?.ct_session;
    const session = db.prepare("SELECT s.user_id, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?").get(token);
    if (session?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const { username, role } = req.body || {};
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!target) return res.status(404).json({ error: "User not found" });
    // Prevent removing last admin
    if (target.role === "admin" && role === "user") {
      const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND active = 1").get().c;
      if (adminCount <= 1) return res.status(400).json({ error: "Cannot remove the last admin" });
    }
    const newUsername = (username || target.username).trim().toLowerCase();
    const newRole = role || target.role;
    if (newUsername !== target.username) {
      const clash = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(newUsername, target.id);
      if (clash) return res.status(400).json({ error: "Username already taken" });
    }
    db.prepare("UPDATE users SET username = ?, role = ? WHERE id = ?").run(newUsername, newRole, target.id);
    logAudit(db, req, {
      action: "update",
      table: "users",
      record_id: target.id,
      before: { username: target.username, role: target.role },
      after: { username: newUsername, role: newRole },
      summary: `Admin updated user ${target.username}: role ${target.role}→${newRole}, username →${newUsername}`,
    });
    res.json({ success: true });
  });

  // Activate / deactivate a user (admin only, cannot deactivate self)
  router.patch("/auth/users/:id/active", requireAuth(db), (req, res) => {
    const token = req.cookies?.ct_session;
    const session = db.prepare("SELECT s.user_id, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?").get(token);
    if (session?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    if (session.user_id === req.params.id) return res.status(400).json({ error: "Cannot deactivate your own account" });
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!target) return res.status(404).json({ error: "User not found" });
    const active = req.body?.active === false || req.body?.active === 0 ? 0 : 1;
    // Prevent deactivating last admin
    if (active === 0 && target.role === "admin") {
      const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND active = 1").get().c;
      if (adminCount <= 1) return res.status(400).json({ error: "Cannot deactivate the last admin" });
    }
    db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active, target.id);
    // Kill existing sessions for deactivated user
    if (active === 0) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
    logAudit(db, req, {
      action: active ? "activate" : "deactivate",
      table: "users",
      record_id: target.id,
      summary: `Admin ${active ? "activated" : "deactivated"} user: ${target.username}`,
    });
    res.json({ success: true });
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