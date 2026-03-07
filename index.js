const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode     = require("qrcode-terminal");
const QRCode     = require("qrcode");
const express    = require("express");
const cors       = require("cors");
const bodyParser = require("body-parser");
const rateLimit  = require("express-rate-limit");
const helmet     = require("helmet");
const path       = require("path");
const fs         = require("fs");
const crypto     = require("crypto");

const { signup, login, requireAuth, googleAuthURL, googleCallback } = require("./auth");

// ── Data directory ────────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log("[Startup] Created data/ directory");
}

const {
  scheduleMessage, editScheduledMessage, cancelScheduledMessage,
  restoreFromTrash, permanentlyDelete,
  getScheduledMessages, getTrashedMessages,
  restoreUserJobs,
} = require("./scheduler");
const { handleAutoReply, getAutoReplyConfig, updateAutoReplyConfig } = require("./autoreply");
const { getTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, recordUsage } = require("./templates");

// ── Per-user WhatsApp clients ─────────────────────────────────────────────────
const userSessions = new Map();

// Temporary store for Google OAuth tokens (30s TTL)
const pendingOAuthTokens = new Map();
function storePendingToken(token, email) {
  const code = crypto.randomBytes(16).toString("hex");
  pendingOAuthTokens.set(code, { token, email, at: Date.now() });
  setTimeout(() => pendingOAuthTokens.delete(code), 30000);
  return code;
}

// Per-user contacts cache (5-minute TTL)
const contactsCache = new Map();
const CONTACTS_TTL  = 1 * 60 * 1000; // 1 minute TTL

function createClient(userId) {
  if (userSessions.has(userId)) return userSessions.get(userId);

  const session = { client: null, qr: null, status: "initializing" };
  userSessions.set(userId, session);

  const puppeteerConfig = {
    headless: true,
    protocolTimeout: 300000,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", "--disable-gpu",
      "--disable-extensions", "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-features=TranslateUI,BlinkGenPropertyTrees",
      "--disable-ipc-flooding-protection",
      "--single-process",
      "--js-flags=--max-old-space-size=512",
    ],
  };
  if (process.env.CHROMIUM_PATH) puppeteerConfig.executablePath = process.env.CHROMIUM_PATH;

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: userId, dataPath: path.join(DATA_DIR, userId, ".wwebjs_auth") }),
    puppeteer: puppeteerConfig,
  });

  client.on("qr", async (qr) => {
    qrcode.generate(qr, { small: true });
    session.qr     = await QRCode.toDataURL(qr);
    session.status = "qr";
    console.log(`[WA:${userId}] QR ready`);
  });

  client.on("ready", () => {
    session.qr     = null;
    session.status = "ready";
    console.log(`[WA:${userId}] Ready`);
    restoreUserJobs(client, userId);
  });

  client.on("disconnected", (reason) => {
    session.status = "disconnected";
    session.qr     = null;
    contactsCache.delete(userId);
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

function getSession(userId) { return userSessions.get(userId); }

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

// ── Input validation ──────────────────────────────────────────────────────────
const MAX_MSG_LEN = 4096;
function validateRecipient(r) {
  const digits = (r || "").replace(/[^0-9]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: "64kb" }));

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again in a minute." },
});

// ── Pages ─────────────────────────────────────────────────────────────────────
const PUBLIC = fs.existsSync(path.join(__dirname, "public"))
  ? path.join(__dirname, "public")
  : __dirname;

app.get("/", (req, res) => res.sendFile(path.join(PUBLIC, "login.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(PUBLIC, "dashboard.html")));

// Serve static assets only — block server .js files from being publicly accessible
app.use(express.static(PUBLIC, {
  index: false,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if ([".js", ".ts", ".json", ".env"].includes(ext)) res.status(403).end();
  },
}));

// ── Auth (public) ─────────────────────────────────────────────────────────────
app.post("/api/auth/signup", authLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });
  const result = signup(email, password);
  if (result.error) return res.status(400).json(result);
  createClient(result.id);
  res.json(result);
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });
  const result = login(email, password);
  if (result.error) return res.status(401).json(result);
  if (!userSessions.has(result.id)) createClient(result.id);
  res.json(result);
});

// ── Google OAuth (public) ─────────────────────────────────────────────────────
app.get("/api/auth/google", (req, res) => {
  try { res.redirect(googleAuthURL()); }
  catch(e) { res.redirect("/?error=" + encodeURIComponent(e.message)); }
});

app.get("/api/auth/google/callback", async (req, res) => {
  try {
    const { token, id, email } = await googleCallback(req.query.code);
    if (!userSessions.has(id)) createClient(id);
    const code = storePendingToken(token, email);
    res.redirect("/dashboard?oauth=" + code);
  } catch(e) {
    console.error("[Google OAuth]", e.message);
    res.redirect("/?error=" + encodeURIComponent("Google sign-in failed. Please try again."));
  }
});

// Exchange short-lived OAuth code for token (public — called by dashboard JS)
app.get("/api/auth/oauth-token", (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).json({ error: "Missing code." });
  const pending = pendingOAuthTokens.get(code);
  if (!pending || Date.now() - pending.at > 30000) {
    pendingOAuthTokens.delete(code);
    return res.status(410).json({ error: "Code expired. Please sign in again." });
  }
  pendingOAuthTokens.delete(code);
  res.json({ token: pending.token, email: pending.email });
});

// ── All routes below require auth ─────────────────────────────────────────────
app.use("/api", requireAuth);

// ── Status / QR ───────────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.json({ connected: false, status: "no_session" });
  res.json({ connected: session.status === "ready", status: session.status, info: session.client?.info || null });
});

app.get("/api/qr-data", (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.json({ connected: false, qr: null });
  if (session.status === "ready") return res.json({ connected: true, qr: null });
  res.json({ connected: false, qr: session.qr || null });
});

app.post("/api/logout-whatsapp", async (req, res) => {
  const session = getSession(req.user.id);
  const forceCleanup = () => {
    if (session) { session.status = "disconnected"; session.qr = null; }
    userSessions.delete(req.user.id);
    contactsCache.delete(req.user.id);
    const authPath = path.join(DATA_DIR, req.user.id, ".wwebjs_auth");
    if (fs.existsSync(authPath)) {
      try { fs.rmSync(authPath, { recursive: true, force: true }); }
      catch(e) { console.error(`[WA:${req.user.id}] Could not clear auth:`, e.message); }
    }
    setTimeout(() => createClient(req.user.id), 1500);
  };
  if (session?.client) {
    try { await Promise.race([session.client.logout(), new Promise((_,rej) => setTimeout(() => rej(), 6000))]); } catch(e) {}
    try { await Promise.race([session.client.destroy(), new Promise((_,rej) => setTimeout(() => rej(), 4000))]); } catch(e) {}
  }
  forceCleanup();
  res.json({ success: true });
});

// ── Contacts ──────────────────────────────────────────────────────────────────
app.get("/api/contacts", async (req, res) => {
  const session = getSession(req.user.id);
  if (!session || session.status !== "ready")
    return res.status(503).json({ error: "WhatsApp not connected." });

  const cached = contactsCache.get(req.user.id);
  if (cached && Date.now() - cached.fetchedAt < CONTACTS_TTL)
    return res.json(cached.data);

  try {
    const contacts = await Promise.race([
      session.client.getContacts(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("getContacts timed out after 30s")), 30000)),
    ]);

    const seen = new Map();
    for (const c of contacts) {
      try {
        const user = c.id && c.id.user;
        if (!user) continue;

        const serialized = c.id._serialized || "";

        // Only allow real @c.us contacts — everything else is groups, system, internal
        if (!serialized.endsWith("@c.us")) continue;

        const num = user.replace(/\D/g, "");
        // Valid international phone number: 7–15 digits (ITU-T E.164)
        if (!num || num.length < 7 || num.length > 15) continue;

        const savedName = (c.name || c.verifiedName || c.shortName || "").trim();
        const pushname  = (c.pushname || "").trim();

        // Must have a saved name — only contacts you've actually saved in your phone
        // pushname alone (what someone set as their WA display name) is NOT reliable —
        // phantom/internal WA numbers sometimes have pushnames too
        if (!savedName) continue;

        const displayName = savedName || pushname;
        const existing    = seen.get(num);
        if (!existing || (!existing.name && displayName)) {
          seen.set(num, { id: serialized, name: displayName, number: num });
        }
      } catch(e) { /* skip malformed contact */ }
    }

    // Named contacts first, then alphabetical
    const result = Array.from(seen.values()).sort((a, b) => {
      if (a.name && !b.name) return -1;
      if (!a.name && b.name) return 1;
      if (a.name && b.name) return a.name.localeCompare(b.name);
      return a.number.localeCompare(b.number);
    });

    console.log(`[Contacts:${req.user.id}] ${result.length} contacts (${result.filter(c => c.name).length} named)`);
    contactsCache.set(req.user.id, { data: result, fetchedAt: Date.now() });
    res.json(result);
  } catch(e) {
    console.error(`[Contacts:${req.user.id}] Error:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// Force-refresh contacts cache
app.post("/api/contacts/refresh", (req, res) => {
  contactsCache.delete(req.user.id);
  res.json({ success: true });
});

// ── Scheduled messages ────────────────────────────────────────────────────────
app.get("/api/scheduled", (req, res) => {
  res.json(getScheduledMessages(req.user.id));
});

app.post("/api/scheduled", (req, res) => {
  const { recipient, message, sendAt, recipientName } = req.body;
  if (!recipient || !message || !sendAt)
    return res.status(400).json({ error: "recipient, message and sendAt are required." });
  if (typeof message !== "string" || message.length > MAX_MSG_LEN)
    return res.status(400).json({ error: `Message must be ${MAX_MSG_LEN} characters or fewer.` });
  const cleanRecipient = validateRecipient(recipient);
  if (!cleanRecipient)
    return res.status(400).json({ error: "Invalid recipient number. Use 7–15 digits, country code first." });
  const sendTime = new Date(sendAt);
  if (isNaN(sendTime) || sendTime <= new Date())
    return res.status(400).json({ error: "sendAt must be a valid future date." });
  const session = getSession(req.user.id);
  if (!session) return res.status(503).json({ error: "Session not found." });
  const job = scheduleMessage(session.client, req.user.id, { recipient: cleanRecipient, recipientName, message, sendAt: sendTime });
  res.json({ success: true, job });
});

app.patch("/api/scheduled/:id", (req, res) => {
  const { recipient, message, sendAt, recipientName } = req.body;
  if (!recipient || !message || !sendAt)
    return res.status(400).json({ error: "recipient, message and sendAt are required." });
  if (typeof message !== "string" || message.length > MAX_MSG_LEN)
    return res.status(400).json({ error: `Message must be ${MAX_MSG_LEN} characters or fewer.` });
  const cleanRecipient = validateRecipient(recipient);
  if (!cleanRecipient)
    return res.status(400).json({ error: "Invalid recipient number." });
  const sendTime = new Date(sendAt);
  if (isNaN(sendTime) || sendTime <= new Date())
    return res.status(400).json({ error: "sendAt must be a valid future date." });
  const session = getSession(req.user.id);
  if (!session) return res.status(503).json({ error: "WhatsApp session not found." });
  const job = editScheduledMessage(session.client, req.user.id, req.params.id, { recipient: cleanRecipient, recipientName, message, sendAt: sendTime });
  if (!job) return res.status(404).json({ error: "Job not found or not editable." });
  res.json({ success: true, job });
});

app.delete("/api/scheduled/:id", (req, res) => {
  const result = cancelScheduledMessage(req.user.id, req.params.id);
  if (!result) return res.status(404).json({ error: "Not found." });
  res.json({ success: true });
});

// Retry a failed message — reschedules it 30 seconds from now
app.post("/api/scheduled/:id/retry", (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(503).json({ error: "Session not found." });
  const msgs = getScheduledMessages(req.user.id);
  const job = msgs.find(m => m.id === req.params.id);
  if (!job) return res.status(404).json({ error: "Message not found." });
  if (job.status !== "failed") return res.status(400).json({ error: "Only failed messages can be retried." });
  const retryAt = new Date(Date.now() + 30 * 1000); // 30s from now
  const updated = editScheduledMessage(session.client, req.user.id, req.params.id, {
    recipient: job.recipient,
    recipientName: job.recipientName,
    message: job.message,
    sendAt: retryAt,
  });
  if (!updated) return res.status(500).json({ error: "Could not reschedule." });
  res.json({ success: true, job: updated });
});

// ── Trash ─────────────────────────────────────────────────────────────────────
app.get("/api/trash", (req, res) => res.json(getTrashedMessages(req.user.id)));

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
app.get("/api/autoreply", (req, res) => res.json(getAutoReplyConfig(req.user.id)));
app.put("/api/autoreply", (req, res) => {
  updateAutoReplyConfig(req.user.id, req.body);
  res.json({ success: true, config: getAutoReplyConfig(req.user.id) });
});

// ── Templates ─────────────────────────────────────────────────────────────────
app.get("/api/templates", (req, res) => res.json(getTemplates(req.user.id)));
app.get("/api/templates/:id", (req, res) => {
  const t = getTemplate(req.user.id, req.params.id);
  if (!t) return res.status(404).json({ error: "Template not found." });
  res.json(t);
});
app.post("/api/templates", (req, res) => {
  const { name, body } = req.body;
  if (!name || !body) return res.status(400).json({ error: "name and body are required." });
  const result = createTemplate(req.user.id, name, body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json({ success: true, template: result });
});
app.patch("/api/templates/:id", (req, res) => {
  const { name, body } = req.body;
  if (!name && !body) return res.status(400).json({ error: "Provide name and/or body to update." });
  const result = updateTemplate(req.user.id, req.params.id, { name, body });
  if (result === null) return res.status(404).json({ error: "Template not found." });
  if (result.error) return res.status(400).json(result);
  res.json({ success: true, template: result });
});
app.delete("/api/templates/:id", (req, res) => {
  const result = deleteTemplate(req.user.id, req.params.id);
  if (!result) return res.status(404).json({ error: "Template not found." });
  res.json({ success: true });
});
app.post("/api/templates/:id/use", (req, res) => {
  const t = getTemplate(req.user.id, req.params.id);
  if (!t) return res.status(404).json({ error: "Template not found." });
  recordUsage(req.user.id, req.params.id);
  res.json({ success: true, body: t.body });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
  restoreExistingSessions();
});
