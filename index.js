const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode    = require("qrcode-terminal");
const QRCode    = require("qrcode");
const express   = require("express");
const cors      = require("cors");
const bodyParser = require("body-parser");
const path      = require("path");
const fs        = require("fs");

const { signup, login, requireAuth } = require("./auth");

// ── Ensure data directory exists on startup ──────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log("[Startup] Created data/ directory");
}
const {
  scheduleMessage, editScheduledMessage, cancelScheduledMessage,
  restoreFromTrash, permanentlyDelete,
  getScheduledMessages, getTrashedMessages,
  restoreUserJobs
} = require("./scheduler");
const { handleAutoReply, getAutoReplyConfig, updateAutoReplyConfig } = require("./autoreply");

// ── Per-user WhatsApp clients ────────────────────────────────────────────────
const userSessions = new Map();

function createClient(userId) {
  if (userSessions.has(userId)) return userSessions.get(userId);

  const session = { client: null, qr: null, status: "initializing" };
  userSessions.set(userId, session);

  // Build puppeteer config — use CHROMIUM_PATH env var if set (e.g. on Railway),
  // otherwise fall back to puppeteer's own bundled Chromium
  const puppeteerConfig = {
    headless: true,
    protocolTimeout: 120000,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", "--disable-gpu",
      "--disable-extensions", "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--js-flags=--max-old-space-size=256"
    ]
  };
  if (process.env.CHROMIUM_PATH) {
    puppeteerConfig.executablePath = process.env.CHROMIUM_PATH;
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: userId, dataPath: path.join(DATA_DIR, userId, ".wwebjs_auth") }),
    puppeteer: puppeteerConfig
  });

  client.on("qr", async (qr) => {
    qrcode.generate(qr, { small: true });
    session.qr = await QRCode.toDataURL(qr);
    session.status = "qr";
    console.log(`[WA:${userId}] QR ready`);
  });

  client.on("ready", () => {
    session.qr = null;
    session.status = "ready";
    console.log(`[WA:${userId}] Ready`);
    restoreUserJobs(client, userId);
  });

  client.on("disconnected", (reason) => {
    session.status = "disconnected";
    session.qr = null;
    console.log(`[WA:${userId}] Disconnected: ${reason}`);
  });

  client.on("auth_failure", () => {
    session.status = "auth_failure";
    console.log(`[WA:${userId}] Auth failure`);
  });

  client.on("message", async (msg) => {
    await handleAutoReply(client, userId, msg);
  });

  session.client = client;
  client.initialize().catch(err => {
    console.error(`[WA:${userId}] Init error:`, err.message);
    session.status = "error";
  });

  return session;
}

function getSession(userId) {
  return userSessions.get(userId);
}

// ── Restore existing users' sessions on startup ──────────────────────────────
function restoreExistingSessions() {
  const usersFile = path.join(DATA_DIR, "users.json");
  if (!fs.existsSync(usersFile)) return;
  try {
    const users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
    Object.values(users).forEach(user => {
      console.log(`[Startup] Restoring session for ${user.email}`);
      createClient(user.id);
    });
  } catch(e) {
    console.error("[Startup] Could not restore sessions:", e.message);
  }
}

// ── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ── Pages — MUST be before express.static so / always serves login.html ──────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.use(express.static(path.join(__dirname, "public")));

// ── Auth routes (public) ─────────────────────────────────────────────────────
app.post("/api/auth/signup", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });
  const result = signup(email, password);
  if (result.error) return res.status(400).json(result);
  createClient(result.id);
  res.json(result);
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });
  const result = login(email, password);
  if (result.error) return res.status(401).json(result);
  if (!userSessions.has(result.id)) createClient(result.id);
  res.json(result);
});

// ── All routes below require auth ────────────────────────────────────────────
app.use("/api", requireAuth);

// ── Status / QR ──────────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.json({ connected: false, status: "no_session" });
  res.json({
    connected: session.status === "ready",
    status: session.status,
    info: session.client?.info || null
  });
});

app.get("/api/qr-data", (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.json({ connected: false, qr: null });
  if (session.status === "ready") return res.json({ connected: true, qr: null });
  res.json({ connected: false, qr: session.qr || null });
});

app.post("/api/logout-whatsapp", async (req, res) => {
  const session = getSession(req.user.id);
  if (!session || !session.client) return res.status(404).json({ error: "No session." });
  try {
    await session.client.logout();
    session.status = "disconnected";
    session.qr = null;
    // Remove from map so createClient can make a fresh session
    userSessions.delete(req.user.id);
    setTimeout(() => createClient(req.user.id), 2000);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Contacts ─────────────────────────────────────────────────────────────────
app.get("/api/contacts", async (req, res) => {
  const session = getSession(req.user.id);
  if (!session || session.status !== "ready")
    return res.status(503).json({ error: "WhatsApp not connected." });
  try {
    const contacts = await session.client.getContacts();
    const seen = new Map();
    contacts
      .filter(c => !c.isGroup && c.id && c.id.user)
      .forEach(c => {
        // c.id.user is the most reliable phone number field
        const num = c.id.user.replace(/\D/g, "");
        if (!num || num.length < 7) return;
        // Prefer saved contact name, then verified/short name, then WA pushname
        const raw = (c.name || c.verifiedName || c.shortName || c.pushname || "").trim();
        // A real name: not empty, not all digits, not just dots/symbols, has at least one letter
        const isRealName = raw.length > 1 && /[a-zA-Z\u00C0-\u024F\u0600-\u06FF\u0900-\u097F]/.test(raw);
        const bestName = isRealName ? raw : "";
        const existing = seen.get(num);
        if (!existing || (!existing.name && bestName)) {
          seen.set(num, { id: c.id._serialized, name: bestName, number: num });
        }
      });
    const result = Array.from(seen.values())
      .sort((a, b) => (a.name || a.number).localeCompare(b.name || b.number));
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Scheduled messages ────────────────────────────────────────────────────────
app.get("/api/scheduled", (req, res) => {
  res.json(getScheduledMessages(req.user.id));
});

app.post("/api/scheduled", (req, res) => {
  const { recipient, message, sendAt, recipientName } = req.body;
  if (!recipient || !message || !sendAt)
    return res.status(400).json({ error: "recipient, message and sendAt are required." });
  const sendTime = new Date(sendAt);
  if (isNaN(sendTime) || sendTime <= new Date())
    return res.status(400).json({ error: "sendAt must be a valid future date." });
  const session = getSession(req.user.id);
  if (!session) return res.status(503).json({ error: "Session not found." });
  const job = scheduleMessage(session.client, req.user.id, { recipient, recipientName, message, sendAt: sendTime });
  res.json({ success: true, job });
});

app.patch("/api/scheduled/:id", (req, res) => {
  const { recipient, message, sendAt, recipientName } = req.body;
  if (!recipient || !message || !sendAt)
    return res.status(400).json({ error: "recipient, message and sendAt are required." });
  const sendTime = new Date(sendAt);
  if (isNaN(sendTime) || sendTime <= new Date())
    return res.status(400).json({ error: "sendAt must be a valid future date." });
  const session = getSession(req.user.id);
  const job = editScheduledMessage(session.client, req.user.id, req.params.id, { recipient, recipientName, message, sendAt: sendTime });
  if (!job) return res.status(404).json({ error: "Job not found or not editable." });
  res.json({ success: true, job });
});

app.delete("/api/scheduled/:id", (req, res) => {
  const result = cancelScheduledMessage(req.user.id, req.params.id);
  if (!result) return res.status(404).json({ error: "Not found." });
  res.json({ success: true });
});

// ── Trash ─────────────────────────────────────────────────────────────────────
app.get("/api/trash", (req, res) => {
  res.json(getTrashedMessages(req.user.id));
});

app.post("/api/trash/:id/restore", (req, res) => {
  const session = getSession(req.user.id);
  const job = restoreFromTrash(session?.client, req.user.id, req.params.id);
  if (!job) return res.status(404).json({ error: "Not found in trash." });
  res.json({ success: true, job });
});

app.delete("/api/trash/:id", (req, res) => {
  const result = permanentlyDelete(req.user.id, req.params.id);
  if (!result) return res.status(404).json({ error: "Not found in trash." });
  res.json({ success: true });
});

// ── Auto-reply ────────────────────────────────────────────────────────────────
app.get("/api/autoreply", (req, res) => {
  res.json(getAutoReplyConfig(req.user.id));
});

app.put("/api/autoreply", (req, res) => {
  updateAutoReplyConfig(req.user.id, req.body);
  res.json({ success: true, config: getAutoReplyConfig(req.user.id) });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
  restoreExistingSessions();
});
