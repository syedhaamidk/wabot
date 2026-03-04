const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Use DATA_DIR env var if set (Railway Volume mount), else local data/
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// JWT_SECRET must be a fixed env variable — never use Math.random() as it
// generates a new secret on every restart, invalidating all existing tokens.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("[auth] FATAL: JWT_SECRET env variable not set. Add it in Railway → Variables.");
  process.exit(1);
}

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
    if (Date.now() - payload.iat > 30 * 24 * 60 * 60 * 1000) return null;
    return payload;
  } catch { return null; }
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return { hash, salt };
}

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
  const userDir = path.join(DATA_DIR, id);
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

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : req.query._token;
  if (!token) return res.status(401).json({ error: "Unauthorized." });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired token." });
  req.user = payload;
  next();
}

// see bottom for full exports

// ─── GOOGLE OAUTH ───────────────────────────────────────────────────────────
// Required env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BASE_URL
// e.g. BASE_URL=https://yourapp.up.railway.app

function googleAuthURL() {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  process.env.BASE_URL + "/api/auth/google/callback",
    response_type: "code",
    scope:         "openid email profile",
    access_type:   "offline",
    prompt:        "select_account",
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on("error", reject);
  });
}

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(body).toString();
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname, method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(payload) }
    };
    const req = https.request(opts, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function googleCallback(code) {
  // Exchange code for tokens
  const tokens = await httpsPost("https://oauth2.googleapis.com/token", {
    code,
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri:  process.env.BASE_URL + "/api/auth/google/callback",
    grant_type:    "authorization_code",
  });

  if (tokens.error) throw new Error(tokens.error_description || tokens.error);

  // Fetch user info
  const info = await httpsGet(
    "https://www.googleapis.com/oauth2/v3/userinfo?access_token=" + tokens.access_token
  );

  if (!info.email) throw new Error("Could not get email from Google.");

  // Upsert user — Google users have no password/salt
  const users = loadUsers();
  const key   = info.email.toLowerCase().trim();
  if (!users[key]) {
    const id = crypto.randomUUID();
    users[key] = { id, email: key, provider: "google", createdAt: new Date().toISOString() };
    saveUsers(users);
    const userDir = path.join(DATA_DIR, id);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  }

  const user = users[key];
  return { token: signToken({ id: user.id, email: key }), id: user.id, email: key };
}

module.exports = { signup, login, requireAuth, verifyToken, googleAuthURL, googleCallback };
