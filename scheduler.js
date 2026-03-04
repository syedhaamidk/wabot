const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── Per-user file paths ──────────────────────────────────────────────────────
function userFile(userId, name) {
  const dir = path.join(__dirname, "data", userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

// ── In-memory store keyed by userId ─────────────────────────────────────────
const userScheduled = new Map(); // userId -> Map<id, job>
const userTrashed   = new Map(); // userId -> Map<id, job>

function getScheduled(userId) {
  if (!userScheduled.has(userId)) userScheduled.set(userId, new Map());
  return userScheduled.get(userId);
}
function getTrashedMap(userId) {
  if (!userTrashed.has(userId)) userTrashed.set(userId, new Map());
  return userTrashed.get(userId);
}

// ── Persistence ──────────────────────────────────────────────────────────────
function saveToFile(userId) {
  const data = Array.from(getScheduled(userId).values()).map(({ timeout, ...job }) => job);
  fs.writeFileSync(userFile(userId, "scheduled.json"), JSON.stringify(data, null, 2));
}

function saveTrash(userId) {
  const data = Array.from(getTrashedMap(userId).values());
  fs.writeFileSync(userFile(userId, "trash.json"), JSON.stringify(data, null, 2));
}

function loadUserData(userId) {
  // Load scheduled
  const sf = userFile(userId, "scheduled.json");
  if (fs.existsSync(sf)) {
    try {
      const items = JSON.parse(fs.readFileSync(sf, "utf8"));
      const m = getScheduled(userId);
      items.forEach(j => m.set(j.id, { ...j, timeout: null }));
    } catch(e) { console.error(`[Scheduler:${userId}] load error:`, e.message); }
  }
  // Load trash
  const tf = userFile(userId, "trash.json");
  if (fs.existsSync(tf)) {
    try {
      const items = JSON.parse(fs.readFileSync(tf, "utf8"));
      const m = getTrashedMap(userId);
      items.forEach(j => m.set(j.id, j));
    } catch(e) {}
  }
}

// ── Wait for client ready ────────────────────────────────────────────────────
function waitForClient(client, maxWaitMs = 30000) {
  return new Promise((resolve, reject) => {
    if (client.info) return resolve();
    const start = Date.now();
    const interval = setInterval(() => {
      if (client.info) { clearInterval(interval); return resolve(); }
      if (Date.now() - start >= maxWaitMs) {
        clearInterval(interval);
        reject(new Error("WhatsApp client not ready after " + maxWaitMs / 1000 + "s"));
      }
    }, 1000);
  });
}

// ── Core send logic ──────────────────────────────────────────────────────────
async function sendJob(client, userId, job) {
  const chatId = job.recipient.includes("@")
    ? job.recipient
    : job.recipient.replace(/[^0-9]/g, "") + "@c.us";

  try {
    await waitForClient(client, 30000);
    await client.sendMessage(chatId, job.message);
    console.log(`[Scheduler:${userId}] Sent to ${job.recipient}`);
    const scheduled = getScheduled(userId);
    const existing = scheduled.get(job.id);
    if (existing) {
      scheduled.set(job.id, { ...existing, status: "sent", sentAt: new Date().toISOString(), timeout: null });
      saveToFile(userId);
    }
    return true;
  } catch (err) {
    const isTimeout = err.message && (
      err.message.includes("timed out") ||
      err.message.includes("protocolTimeout") ||
      err.message.includes("Target closed") ||
      err.message.includes("not ready")
    );
    console.error(`[Scheduler:${userId}] Failed (${isTimeout ? "timeout" : "error"}): ${err.message}`);
    const scheduled = getScheduled(userId);
    const existing = scheduled.get(job.id);
    if (existing) {
      scheduled.set(job.id, { ...existing, status: "failed", failedAt: new Date().toISOString(), error: err.message, timeout: null });
      saveToFile(userId);
    }
    return false;
  }
}

// ── Retry with exponential backoff: 15s → 45s → 135s ────────────────────────
function sendWithRetry(client, userId, job, attempts, delayMs) {
  const timeout = setTimeout(async () => {
    const scheduled = getScheduled(userId);
    const existing = scheduled.get(job.id);
    if (existing) {
      scheduled.set(job.id, { ...existing, status: "pending", timeout: null });
      saveToFile(userId);
    }
    const ok = await sendJob(client, userId, job);
    if (!ok && attempts > 1) {
      const nextDelay = delayMs * 3;
      console.log(`[Scheduler:${userId}] Retry ${4 - attempts + 1}/3 in ${nextDelay / 1000}s`);
      const current = scheduled.get(job.id);
      if (current) { scheduled.set(job.id, { ...current, status: "pending" }); saveToFile(userId); }
      sendWithRetry(client, userId, job, attempts - 1, nextDelay);
    }
  }, delayMs);

  const scheduled = getScheduled(userId);
  const existing = scheduled.get(job.id);
  if (existing) scheduled.set(job.id, { ...existing, timeout });
}

// ── Public API ───────────────────────────────────────────────────────────────
function scheduleMessage(client, userId, { recipient, recipientName, message, sendAt }) {
  const id = crypto.randomUUID();
  const sendTime = new Date(sendAt);
  const delay = sendTime.getTime() - Date.now();
  const timeout = setTimeout(() => sendJob(client, userId, { id, recipient, recipientName, message, sendAt: sendTime.toISOString() }), delay);
  const job = { id, recipient, recipientName: recipientName || recipient, message, sendAt: sendTime.toISOString(), status: "pending" };
  getScheduled(userId).set(id, { ...job, timeout });
  saveToFile(userId);
  return job;
}

function editScheduledMessage(client, userId, id, { recipient, recipientName, message, sendAt }) {
  const scheduled = getScheduled(userId);
  const existing = scheduled.get(id);
  if (!existing || existing.status !== "pending") return null;
  if (existing.timeout) clearTimeout(existing.timeout);
  const sendTime = new Date(sendAt);
  const delay = sendTime.getTime() - Date.now();
  if (delay <= 0) return null;
  const timeout = setTimeout(() => sendJob(client, userId, { id, recipient, recipientName, message, sendAt: sendTime.toISOString() }), delay);
  const updated = { ...existing, recipient, recipientName: recipientName || existing.recipientName || recipient, message, sendAt: sendTime.toISOString(), timeout, editedAt: new Date().toISOString() };
  scheduled.set(id, updated);
  saveToFile(userId);
  const { timeout: _t, ...job } = updated;
  return job;
}

function cancelScheduledMessage(userId, id) {
  const scheduled = getScheduled(userId);
  const job = scheduled.get(id);
  if (!job) return null;
  if (job.timeout) clearTimeout(job.timeout);
  const { timeout, ...clean } = job;
  getTrashedMap(userId).set(id, { ...clean, deletedAt: new Date().toISOString() });
  scheduled.delete(id);
  saveToFile(userId);
  saveTrash(userId);
  return true;
}

function restoreFromTrash(client, userId, id) {
  const trashed = getTrashedMap(userId);
  const job = trashed.get(id);
  if (!job) return null;
  trashed.delete(id);
  saveTrash(userId);
  const scheduled = getScheduled(userId);
  if (job.status === "pending") {
    const sendTime = new Date(job.sendAt).getTime();
    const now = Date.now();
    if (sendTime > now) {
      const timeout = setTimeout(() => sendJob(client, userId, job), sendTime - now);
      scheduled.set(job.id, { ...job, timeout });
    } else {
      scheduled.set(job.id, { ...job, timeout: null });
      sendWithRetry(client, userId, job, 3, 15000);
    }
  } else {
    scheduled.set(job.id, { ...job, timeout: null });
  }
  saveToFile(userId);
  const stored = scheduled.get(id);
  const { timeout, ...clean } = stored || job;
  return clean;
}

function permanentlyDelete(userId, id) {
  const trashed = getTrashedMap(userId);
  if (!trashed.has(id)) return null;
  trashed.delete(id);
  saveTrash(userId);
  return true;
}

function getScheduledMessages(userId) {
  return Array.from(getScheduled(userId).values()).map(({ timeout, ...job }) => job);
}

function getTrashedMessages(userId) {
  return Array.from(getTrashedMap(userId).values());
}

// ── Restore all users' jobs on startup ───────────────────────────────────────
function restoreAllJobs(getUserClient) {
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) return;

  const entries = fs.readdirSync(dataDir, { withFileTypes: true });
  entries.forEach(entry => {
    if (!entry.isDirectory()) return;
    const userId = entry.name;
    if (userId === "users.json") return; // skip non-dir

    loadUserData(userId);

    const client = getUserClient(userId);
    if (!client) return;

    const scheduled = getScheduled(userId);
    const now = Date.now();
    let restored = 0, sentLate = 0;

    scheduled.forEach(job => {
      if (job.status === "sent" || job.status === "failed") return;
      const sendTime = new Date(job.sendAt).getTime();
      if (sendTime > now) {
        const delay = sendTime - now;
        const timeout = setTimeout(() => sendJob(client, userId, job), delay);
        scheduled.set(job.id, { ...job, timeout });
        restored++;
      } else {
        scheduled.set(job.id, { ...job, timeout: null });
        sendWithRetry(client, userId, job, 3, 15000);
        sentLate++;
      }
    });

    if (restored + sentLate > 0)
      console.log(`[Scheduler:${userId}] Restored ${restored} future, ${sentLate} late-send retries`);
  });
}

// ── Restore single user's jobs (called when their client connects) ────────────
function restoreUserJobs(client, userId) {
  loadUserData(userId);
  const scheduled = getScheduled(userId);
  const now = Date.now();
  let restored = 0, sentLate = 0, skipped = 0;

  scheduled.forEach(job => {
    if (job.status === "sent" || job.status === "failed") { skipped++; return; }
    const sendTime = new Date(job.sendAt).getTime();
    if (sendTime > now) {
      const delay = sendTime - now;
      const timeout = setTimeout(() => sendJob(client, userId, job), delay);
      scheduled.set(job.id, { ...job, timeout });
      restored++;
    } else {
      scheduled.set(job.id, { ...job, timeout: null });
      sendWithRetry(client, userId, job, 3, 15000);
      sentLate++;
    }
  });

  saveToFile(userId);
  console.log(`[Scheduler:${userId}] Restored ${restored} future, ${sentLate} late retries, ${skipped} completed`);
}

module.exports = {
  scheduleMessage,
  editScheduledMessage,
  cancelScheduledMessage,
  restoreFromTrash,
  permanentlyDelete,
  getScheduledMessages,
  getTrashedMessages,
  restoreUserJobs,
  loadUserData
};
