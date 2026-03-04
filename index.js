const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const {
  scheduleMessage,
  editScheduledMessage,
  cancelScheduledMessage,
  restoreFromTrash,
  permanentlyDelete,
  getScheduledMessages,
  getTrashedMessages,
  restoreJobs
} = require("./scheduler");
const { handleAutoReply, getAutoReplyConfig, updateAutoReplyConfig } = require("./autoreply");

// ── WhatsApp Client ──────────────────────────────
let latestQR = null;

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  }
});

client.on("qr", async (qr) => {
  qrcode.generate(qr, { small: true });
  latestQR = await QRCode.toDataURL(qr);
  console.log("QR ready — visit /qr in your browser to scan.");
});

client.on("ready", () => {
  latestQR = null;
  console.log("WhatsApp client is ready!");
  restoreJobs(client);
});

client.on("message", async (msg) => {
  await handleAutoReply(client, msg);
});

client.initialize();

// ── Express Server ───────────────────────────────
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// QR code page
app.get("/qr", (req, res) => {
  if (!latestQR) return res.send("No QR available — already connected or wait a few seconds and refresh.");
  res.send(`
    <html><body style="background:#f2f2ef;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif">
      <h2 style="margin-bottom:20px">Scan with WhatsApp</h2>
      <img src="${latestQR}" style="width:280px;border-radius:12px"/>
      <p style="margin-top:16px;color:#888;font-size:13px">WhatsApp → Linked Devices → Link a Device</p>
      <p style="color:#aaa;font-size:12px;margin-top:8px">Page auto-refreshes every 20 seconds</p>
      <script>setTimeout(()=>location.reload(), 20000)</script>
    </body></html>
  `);
});

// ── Status ───────────────────────────────────────
app.get("/api/status", (req, res) => {
  res.json({ connected: client.info ? true : false, info: client.info || null });
});

// ── QR data (for dashboard embed) ────────────────
app.get("/api/qr-data", (req, res) => {
  if (client.info) return res.json({ connected: true, qr: null });
  if (!latestQR)   return res.json({ connected: false, qr: null });
  res.json({ connected: false, qr: latestQR });
});

// ── Scheduled messages ───────────────────────────
app.get("/api/scheduled", (req, res) => {
  res.json(getScheduledMessages());
});

app.post("/api/scheduled", (req, res) => {
  const { recipient, message, sendAt } = req.body;
  if (!recipient || !message || !sendAt)
    return res.status(400).json({ error: "recipient, message and sendAt are required." });
  const sendTime = new Date(sendAt);
  if (isNaN(sendTime) || sendTime <= new Date())
    return res.status(400).json({ error: "sendAt must be a valid future date." });
  const job = scheduleMessage(client, { recipient, message, sendAt: sendTime });
  res.json({ success: true, job });
});

// Edit a pending message
app.patch("/api/scheduled/:id", (req, res) => {
  const { recipient, message, sendAt } = req.body;
  if (!recipient || !message || !sendAt)
    return res.status(400).json({ error: "recipient, message and sendAt are required." });
  const sendTime = new Date(sendAt);
  if (isNaN(sendTime) || sendTime <= new Date())
    return res.status(400).json({ error: "sendAt must be a valid future date." });
  const job = editScheduledMessage(client, req.params.id, { recipient, message, sendAt: sendTime });
  if (!job) return res.status(404).json({ error: "Job not found or not editable (already sent/failed)." });
  res.json({ success: true, job });
});

// Soft-delete (move to trash)
app.delete("/api/scheduled/:id", (req, res) => {
  const result = cancelScheduledMessage(req.params.id);
  if (!result) return res.status(404).json({ error: "Not found." });
  res.json({ success: true });
});

// ── Trash ────────────────────────────────────────
app.get("/api/trash", (req, res) => {
  res.json(getTrashedMessages());
});

// Restore from trash
app.post("/api/trash/:id/restore", (req, res) => {
  const job = restoreFromTrash(client, req.params.id);
  if (!job) return res.status(404).json({ error: "Not found in trash." });
  res.json({ success: true, job });
});

// Permanently delete from trash
app.delete("/api/trash/:id", (req, res) => {
  const result = permanentlyDelete(req.params.id);
  if (!result) return res.status(404).json({ error: "Not found in trash." });
  res.json({ success: true });
});

// ── Auto-reply ───────────────────────────────────
app.get("/api/autoreply", (req, res) => {
  res.json(getAutoReplyConfig());
});

app.put("/api/autoreply", (req, res) => {
  updateAutoReplyConfig(req.body);
  res.json({ success: true, config: getAutoReplyConfig() });
});

// ── Start ────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
