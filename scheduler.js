const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE       = path.join(__dirname, "scheduled.json");
const TRASH_FILE = path.join(__dirname, "trash.json");

const scheduledMessages = new Map(); // active + sent + failed
const trashedMessages   = new Map(); // soft-deleted

// ── Persistence ─────────────────────────────────────────────────────────────
function saveToFile() {
  const data = Array.from(scheduledMessages.values()).map(({ timeout, ...job }) => job);
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function saveTrash() {
  const data = Array.from(trashedMessages.values());
  fs.writeFileSync(TRASH_FILE, JSON.stringify(data, null, 2));
}

function loadTrash() {
  if (!fs.existsSync(TRASH_FILE)) return;
  try {
    const items = JSON.parse(fs.readFileSync(TRASH_FILE, "utf8"));
    items.forEach(item => trashedMessages.set(item.id, item));
  } catch (e) {
    console.error("[Scheduler] Could not load trash.json:", e.message);
  }
}

// ── Wait until WhatsApp client is fully ready ────────────────────────────────
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
async function sendJob(client, job) {
  const chatId = job.recipient.includes("@")
    ? job.recipient
    : job.recipient.replace(/[^0-9]/g, "") + "@c.us";

  try {
    // Wait for WA session to be alive before sending
    await waitForClient(client, 30000);
    await client.sendMessage(chatId, job.message);
    console.log("[Scheduler] Sent to " + job.recipient);
    const existing = scheduledMessages.get(job.id);
    if (existing) {
      scheduledMessages.set(job.id, { ...existing, status: "sent", sentAt: new Date().toISOString(), timeout: null });
      saveToFile();
    }
    return true;
  } catch (err) {
    const isTimeout = err.message && (
      err.message.includes("timed out") ||
      err.message.includes("protocolTimeout") ||
      err.message.includes("Target closed") ||
      err.message.includes("not ready")
    );
    console.error(`[Scheduler] Failed to send to ${job.recipient} (${isTimeout ? "timeout" : "error"}): ${err.message}`);
    const existing = scheduledMessages.get(job.id);
    if (existing) {
      scheduledMessages.set(job.id, { ...existing, status: "failed", failedAt: new Date().toISOString(), error: err.message, timeout: null });
      saveToFile();
    }
    return false;
  }
}

// ── Retry helper — exponential backoff: 15s → 45s → 135s ────────────────────
function sendWithRetry(client, job, attempts, delayMs) {
  const timeout = setTimeout(async () => {
    // Reset to pending so UI shows it's being retried
    const existing = scheduledMessages.get(job.id);
    if (existing) {
      scheduledMessages.set(job.id, { ...existing, status: "pending", timeout: null });
      saveToFile();
    }

    const ok = await sendJob(client, job);
    if (!ok && attempts > 1) {
      const nextDelay = delayMs * 3;
      console.log(`[Scheduler] Retry ${4 - attempts + 1}/3 for ${job.recipient} in ${nextDelay / 1000}s`);
      const current = scheduledMessages.get(job.id);
      if (current) {
        scheduledMessages.set(job.id, { ...current, status: "pending" });
        saveToFile();
      }
      sendWithRetry(client, job, attempts - 1, nextDelay);
    }
  }, delayMs);

  // Store the latest timeout reference so it can be cancelled if needed
  const existing = scheduledMessages.get(job.id);
  if (existing) scheduledMessages.set(job.id, { ...existing, timeout });
}

// ── Schedule a new message ───────────────────────────────────────────────────
function scheduleMessage(client, { recipient, message, sendAt }) {
  const id = crypto.randomUUID();
  const sendTime = new Date(sendAt);
  const delay = sendTime.getTime() - Date.now();

  const timeout = setTimeout(() => sendJob(client, { id, recipient, message, sendAt: sendTime.toISOString() }), delay);

  const job = { id, recipient, message, sendAt: sendTime.toISOString(), status: "pending" };
  scheduledMessages.set(id, { ...job, timeout });
  saveToFile();
  return job;
}

// ── Edit a pending message ───────────────────────────────────────────────────
function editScheduledMessage(client, id, { recipient, message, sendAt }) {
  const existing = scheduledMessages.get(id);
  if (!existing || existing.status !== "pending") return null;

  if (existing.timeout) clearTimeout(existing.timeout);

  const sendTime = new Date(sendAt);
  const delay = sendTime.getTime() - Date.now();
  if (delay <= 0) return null;

  const timeout = setTimeout(() => sendJob(client, { id, recipient, message, sendAt: sendTime.toISOString() }), delay);
  const updated = { ...existing, recipient, message, sendAt: sendTime.toISOString(), timeout, editedAt: new Date().toISOString() };
  scheduledMessages.set(id, updated);
  saveToFile();
  const { timeout: _t, ...job } = updated;
  return job;
}

// ── Soft-delete (move to trash) ──────────────────────────────────────────────
function cancelScheduledMessage(id) {
  const job = scheduledMessages.get(id);
  if (!job) return null;

  if (job.timeout) clearTimeout(job.timeout);

  const { timeout, ...clean } = job;
  trashedMessages.set(id, { ...clean, deletedAt: new Date().toISOString() });
  scheduledMessages.delete(id);

  saveToFile();
  saveTrash();
  return true;
}

// ── Restore from trash ───────────────────────────────────────────────────────
function restoreFromTrash(client, id) {
  const job = trashedMessages.get(id);
  if (!job) return null;

  trashedMessages.delete(id);
  saveTrash();

  if (job.status === "pending") {
    const sendTime = new Date(job.sendAt).getTime();
    const now = Date.now();
    if (sendTime > now) {
      const timeout = setTimeout(() => sendJob(client, job), sendTime - now);
      scheduledMessages.set(job.id, { ...job, timeout });
    } else {
      // Past-due restore — retry with backoff
      scheduledMessages.set(job.id, { ...job, timeout: null });
      sendWithRetry(client, job, 3, 15000);
    }
  } else {
    scheduledMessages.set(job.id, { ...job, timeout: null });
  }

  saveToFile();
  const stored = scheduledMessages.get(id);
  const { timeout, ...clean } = stored || job;
  return clean;
}

// ── Permanently delete from trash ────────────────────────────────────────────
function permanentlyDelete(id) {
  if (!trashedMessages.has(id)) return null;
  trashedMessages.delete(id);
  saveTrash();
  return true;
}

// ── Getters ──────────────────────────────────────────────────────────────────
function getScheduledMessages() {
  return Array.from(scheduledMessages.values()).map(({ timeout, ...job }) => job);
}

function getTrashedMessages() {
  return Array.from(trashedMessages.values());
}

// ── Restore jobs on server startup ──────────────────────────────────────────
function restoreJobs(client) {
  loadTrash();

  if (!fs.existsSync(FILE)) return;
  let jobs;
  try {
    jobs = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (e) {
    console.error("[Scheduler] Could not parse scheduled.json:", e.message);
    return;
  }

  const now = Date.now();
  let restored = 0, sentLate = 0, skipped = 0;

  jobs.forEach(job => {
    if (job.status === "sent" || job.status === "failed") {
      scheduledMessages.set(job.id, { ...job, timeout: null });
      skipped++;
      return;
    }

    const sendTime = new Date(job.sendAt).getTime();
    if (sendTime > now) {
      // Future job — schedule normally
      const delay = sendTime - now;
      const timeout = setTimeout(() => sendJob(client, job), delay);
      scheduledMessages.set(job.id, { ...job, timeout });
      console.log("[Scheduler] Restored future job for " + job.recipient + " (in " + Math.round(delay / 1000) + "s)");
      restored++;
    } else {
      // Past-due — wait 15s for WhatsApp session to warm up, then retry up to 3x
      // Backoff: 15s → 45s → 135s
      console.log("[Scheduler] Past-due job for " + job.recipient + " (was due " + new Date(job.sendAt).toLocaleString() + ") — retrying in 15s");
      scheduledMessages.set(job.id, { ...job, timeout: null });
      sendWithRetry(client, job, 3, 15000);
      sentLate++;
    }
  });

  saveToFile();
  console.log(`[Scheduler] Restored ${restored} future, queued ${sentLate} late-send retries, reloaded ${skipped} completed.`);
}

module.exports = {
  scheduleMessage,
  editScheduledMessage,
  cancelScheduledMessage,
  restoreFromTrash,
  permanentlyDelete,
  getScheduledMessages,
  getTrashedMessages,
  restoreJobs
};
