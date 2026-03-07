const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

// ── Per-user file paths ───────────────────────────────────────────────────────
function userFile(userId, name) {
  const dir = path.join(DATA_DIR, userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

// ── In-memory store ──────────────────────────────────────────────────────────
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

// ── Debounced async writes (avoids blocking event loop on every operation) ────
const writeTimers = new Map();
function debouncedWrite(key, fn, delay = 300) {
  if (writeTimers.has(key)) clearTimeout(writeTimers.get(key));
  writeTimers.set(key, setTimeout(() => {
    writeTimers.delete(key);
    fn();
  }, delay));
}

function saveToFile(userId) {
  debouncedWrite(`sched:${userId}`, () => {
    const data = Array.from(getScheduled(userId).values()).map(({ timeout, ...job }) => job);
    fs.writeFile(userFile(userId, "scheduled.json"), JSON.stringify(data, null, 2), err => {
      if (err) console.error(`[Scheduler:${userId}] Save error:`, err.message);
    });
  });
}

function saveTrash(userId) {
  debouncedWrite(`trash:${userId}`, () => {
    const data = Array.from(getTrashedMap(userId).values());
    fs.writeFile(userFile(userId, "trash.json"), JSON.stringify(data, null, 2), err => {
      if (err) console.error(`[Scheduler:${userId}] Trash save error:`, err.message);
    });
  });
}

function loadUserData(userId) {
  const sf = userFile(userId, "scheduled.json");
  if (fs.existsSync(sf)) {
    try {
      const items = JSON.parse(fs.readFileSync(sf, "utf8"));
      const m = getScheduled(userId);
      items.forEach(j => m.set(j.id, { ...j, timeout: null }));
    } catch(e) { console.error(`[Scheduler:${userId}] Load error:`, e.message); }
  }
  const tf = userFile(userId, "trash.json");
  if (fs.existsSync(tf)) {
    try {
      const items = JSON.parse(fs.readFileSync(tf, "utf8"));
      const m = getTrashedMap(userId);
      items.forEach(j => m.set(j.id, j));
    } catch(e) {}
  }
}

// ── Wait for WA client ready ─────────────────────────────────────────────────
function waitForClient(client, maxWaitMs = 60000) {
  return new Promise((resolve, reject) => {
    // client.info is populated once WA is ready
    if (client.info) return resolve();
    const start    = Date.now();
    const interval = setInterval(() => {
      if (client.info) { clearInterval(interval); return resolve(); }
      if (Date.now() - start >= maxWaitMs) {
        clearInterval(interval);
        // If we've waited long enough, try anyway — better than failing silently
        reject(new Error(`WhatsApp client not ready after ${maxWaitMs/1000}s`));
      }
    }, 500); // check every 500ms instead of 1000ms
  });
}

// ── Core send ────────────────────────────────────────────────────────────────
async function sendJob(client, userId, job) {
  const chatId = job.recipient.includes("@")
    ? job.recipient
    : job.recipient.replace(/[^0-9]/g, "") + "@c.us";

  try {
    await waitForClient(client, 60000);
    await client.sendMessage(chatId, job.message);
    console.log(`[Scheduler:${userId}] Sent to ${job.recipient}`);
    const scheduled = getScheduled(userId);
    const existing  = scheduled.get(job.id);
    if (existing) {
      scheduled.set(job.id, { ...existing, status: "sent", sentAt: new Date().toISOString(), timeout: null });
      saveToFile(userId);
    }
    return true;
  } catch (err) {
    console.error(`[Scheduler:${userId}] Failed: ${err.message}`);
    const scheduled = getScheduled(userId);
    const existing  = scheduled.get(job.id);
    if (existing) {
      scheduled.set(job.id, { ...existing, status: "failed", failedAt: new Date().toISOString(), error: err.message, timeout: null });
      saveToFile(userId);
    }
    return false;
  }
}

// ── Retry with exponential backoff: 15s → 45s → 135s ────────────────────────
const MAX_RETRIES = 3;
function sendWithRetry(client, userId, job, attemptsLeft, retryDelayMs) {
  // First attempt: fire immediately. Retries use exponential backoff.
  const isFirstAttempt = attemptsLeft === MAX_RETRIES;
  const delay = isFirstAttempt ? 0 : retryDelayMs;

  const timeout = setTimeout(async () => {
    const scheduled = getScheduled(userId);
    const existing  = scheduled.get(job.id);
    if (existing) {
      scheduled.set(job.id, { ...existing, status: "pending", timeout: null });
      saveToFile(userId);
    }
    const ok = await sendJob(client, userId, job);
    if (!ok && attemptsLeft > 1) {
      const nextDelay  = retryDelayMs * 3;
      const attemptNum = MAX_RETRIES - attemptsLeft + 1;
      console.log(`[Scheduler:${userId}] Retry ${attemptNum}/${MAX_RETRIES} in ${nextDelay/1000}s`);
      const current = scheduled.get(job.id);
      if (current) { scheduled.set(job.id, { ...current, status: "pending" }); saveToFile(userId); }
      sendWithRetry(client, userId, job, attemptsLeft - 1, nextDelay);
    }
  }, delay);

  const scheduled = getScheduled(userId);
  const existing  = scheduled.get(job.id);
  if (existing) scheduled.set(job.id, { ...existing, timeout });
}

// ── Public API ───────────────────────────────────────────────────────────────
function scheduleMessage(client, userId, { recipient, recipientName, message, sendAt }) {
  const id       = crypto.randomUUID();
  const sendTime = new Date(sendAt);
  const delay    = Math.max(0, sendTime.getTime() - Date.now()); // never negative
  const job      = { id, recipient, recipientName: recipientName || recipient, message, sendAt: sendTime.toISOString(), status: "pending" };
  const timeout  = setTimeout(() => sendWithRetry(client, userId, job, MAX_RETRIES, 15000), delay);
  getScheduled(userId).set(id, { ...job, timeout });
  saveToFile(userId);
  return job;
}

function editScheduledMessage(client, userId, id, { recipient, recipientName, message, sendAt }) {
  const scheduled = getScheduled(userId);
  const existing  = scheduled.get(id);
  if (!existing || existing.status !== "pending") return null;
  if (existing.timeout) clearTimeout(existing.timeout);
  const sendTime = new Date(sendAt);
  const delay    = sendTime.getTime() - Date.now();
  if (delay <= 0) return null;
  const updatedJob = { ...existing, recipient, recipientName: recipientName || existing.recipientName || recipient, message, sendAt: sendTime.toISOString(), editedAt: new Date().toISOString() };
  const timeout    = setTimeout(() => sendWithRetry(client, userId, updatedJob, MAX_RETRIES, 15000), delay);
  scheduled.set(id, { ...updatedJob, timeout });
  saveToFile(userId);
  const { timeout: _t, ...job } = { ...updatedJob, timeout };
  return job;
}

function cancelScheduledMessage(userId, id) {
  const scheduled = getScheduled(userId);
  const job       = scheduled.get(id);
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
  const job     = trashed.get(id);
  if (!job) return null;
  trashed.delete(id);
  saveTrash(userId);
  const scheduled = getScheduled(userId);
  if (job.status === "pending") {
    const sendTime = new Date(job.sendAt).getTime();
    const now      = Date.now();
    if (sendTime > now) {
      // Future: schedule normally with retries
      const timeout = setTimeout(() => sendWithRetry(client, userId, job, MAX_RETRIES, 15000), sendTime - now);
      scheduled.set(job.id, { ...job, timeout });
    } else {
      // Overdue: send immediately with retries (was using sendJob without retries before — fixed)
      scheduled.set(job.id, { ...job, timeout: null });
      sendWithRetry(client, userId, job, MAX_RETRIES, 15000);
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

// ── Restore single user's jobs on client connect ──────────────────────────────
function restoreUserJobs(client, userId) {
  loadUserData(userId);
  const scheduled = getScheduled(userId);
  const now       = Date.now();
  let restored = 0, sentLate = 0, skipped = 0;

  scheduled.forEach(job => {
    if (job.status === "sent" || job.status === "failed") { skipped++; return; }
    const sendTime = new Date(job.sendAt).getTime();
    if (sendTime > now) {
      const timeout = setTimeout(() => sendWithRetry(client, userId, job, MAX_RETRIES, 15000), sendTime - now);
      scheduled.set(job.id, { ...job, timeout });
      restored++;
    } else {
      scheduled.set(job.id, { ...job, timeout: null });
      sendWithRetry(client, userId, job, MAX_RETRIES, 15000);
      sentLate++;
    }
  });

  saveToFile(userId);
  console.log(`[Scheduler:${userId}] Restored ${restored} future, ${sentLate} late retries, ${skipped} completed`);
}

module.exports = {
  scheduleMessage, editScheduledMessage, cancelScheduledMessage,
  restoreFromTrash, permanentlyDelete,
  getScheduledMessages, getTrashedMessages,
  restoreUserJobs, loadUserData,
};
