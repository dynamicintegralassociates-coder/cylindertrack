/**
 * Card encryption using AES-256-GCM.
 * Key is derived from an environment variable or a generated secret stored in the DB.
 */
const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const TAG_LEN = 16;

let _key = null;

function getKey(db) {
  if (_key) return _key;

  // Try env var first
  if (process.env.CT_ENCRYPT_KEY) {
    _key = crypto.createHash("sha256").update(process.env.CT_ENCRYPT_KEY).digest();
    return _key;
  }

  // Otherwise generate and store in settings
  const row = db.prepare("SELECT value FROM settings WHERE key = 'encrypt_key'").get();
  if (row) {
    _key = Buffer.from(row.value, "hex");
  } else {
    _key = crypto.randomBytes(32);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('encrypt_key', ?)").run(_key.toString("hex"));
  }
  return _key;
}

function encrypt(plaintext, db) {
  if (!plaintext) return "";
  const key = getKey(db);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted;
}

function decrypt(stored, db) {
  if (!stored || !stored.includes(":")) return "";
  try {
    const key = getKey(db);
    const parts = stored.split(":");
    if (parts.length < 3) return "";
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const ciphertext = parts.slice(2).join(":");
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (e) {
    console.error("Decryption failed:", e.message);
    return "";
  }
}

function maskCard(number) {
  if (!number) return "";
  const digits = number.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return "•••• •••• •••• " + digits.slice(-4);
}

module.exports = { encrypt, decrypt, maskCard };
