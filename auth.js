const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const USERS_FILE = path.join(__dirname, "data", "users.json");

// ── Ensure data dir exists ───────────────────────────────────────────────────
function ensureDataDir() {
  const dir = path.join(__dirname, "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Simple JWT (no external deps) ───────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || "wabot-secret-change-in-production-" + Math.random();

function base64url(str) {
  return Buffer.from(str).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signToken(payload) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body   = base64url(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig    = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64")
                   .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split(".");
    const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64")
                       .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, "base64").toString());
    // Token expires in 30 days
    if (Date.now() - payload.iat > 30 * 24 * 60 * 60 * 1000) return null;
    return payload;
  } catch { return null; }
}

// ── Password hashing ─────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return { hash, salt };
}

// ── User store ───────────────────────────────────────────────────────────────
function loadUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); }
  catch { return {}; }
}

function saveUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ── Auth functions ───────────────────────────────────────────────────────────
function signup(email, password) {
  const users = loadUsers();
  const key = email.toLowerCase().trim();
  if (users[key]) return { error: "Email already registered." };
  if (!email.includes("@")) return { error: "Invalid email." };
  if (password.length < 6) return { error: "Password must be at least 6 characters." };
  const id = crypto.randomUUID();
  const { hash, salt } = hashPassword(password);
  users[key] = { id, email: key, hash, salt, createdAt: new Date().toISOString() };
  saveUsers(users);
  // Create user data dir
  const userDir = path.join(__dirname, "data", id);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  return { token: signToken({ id, email: key }), id, email: key };
}

function login(email, password) {
  const users = loadUsers();
  const key = email.toLowerCase().trim();
  const user = users[key];
  if (!user) return { error: "Invalid email or password." };
  const { hash } = hashPassword(password, user.salt);
  if (hash !== user.hash) return { error: "Invalid email or password." };
  return { token: signToken({ id: user.id, email: key }), id: user.id, email: key };
}

// ── Express middleware ────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : req.query._token;
  if (!token) return res.status(401).json({ error: "Unauthorized." });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired token." });
  req.user = payload;
  next();
}

module.exports = { signup, login, requireAuth, verifyToken };
