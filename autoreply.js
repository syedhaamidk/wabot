const fs   = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

const defaultConfig = () => ({
  enabled:          false,
  busyMessage:      "Hey! I am currently busy and will get back to you soon.",
  schedule:         { enabled: false, startTime: "22:00", endTime: "08:00" },
  cooldownMinutes:  60,
  replyToGroups:    false,
  keywords:         [], // empty = reply to all messages
});

const userConfigs  = new Map(); // userId -> config
const userReplyLog = new Map(); // userId -> Map<chatId, timestamp>

// ── Config persistence ────────────────────────────────────────────────────────
function getConfig(userId) {
  if (!userConfigs.has(userId)) {
    const file = path.join(DATA_DIR, userId, "autoreply.json");
    if (fs.existsSync(file)) {
      try { userConfigs.set(userId, JSON.parse(fs.readFileSync(file, "utf8"))); }
      catch { userConfigs.set(userId, defaultConfig()); }
    } else {
      userConfigs.set(userId, defaultConfig());
    }
  }
  return userConfigs.get(userId);
}

function saveConfig(userId, config) {
  const dir = path.join(DATA_DIR, userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "autoreply.json"), JSON.stringify(config, null, 2));
}

// ── Reply log ─────────────────────────────────────────────────────────────────
function getReplyLog(userId) {
  if (!userReplyLog.has(userId)) userReplyLog.set(userId, new Map());
  return userReplyLog.get(userId);
}

// Prune stale entries from the reply log to prevent unbounded memory growth
function pruneReplyLog(userId, cooldownMinutes) {
  const log     = getReplyLog(userId);
  const cutoff  = Date.now() - cooldownMinutes * 60 * 1000;
  for (const [chatId, ts] of log) {
    if (ts < cutoff) log.delete(chatId);
  }
}

// ── Schedule helpers ──────────────────────────────────────────────────────────
function isWithinSchedule(config) {
  if (!config.schedule.enabled) return true;
  const now = new Date();
  const [startH, startM] = config.schedule.startTime.split(":").map(Number);
  const [endH,   endM  ] = config.schedule.endTime.split(":").map(Number);
  const cur   = now.getHours() * 60 + now.getMinutes();
  const start = startH * 60 + startM;
  const end   = endH   * 60 + endM;
  // Handle overnight spans (e.g. 22:00 → 08:00)
  if (start > end) return cur >= start || cur < end;
  return cur >= start && cur < end;
}

function isOnCooldown(userId, chatId, cooldownMinutes) {
  const last = getReplyLog(userId).get(chatId);
  if (!last) return false;
  return (Date.now() - last) / 60000 < cooldownMinutes;
}

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleAutoReply(client, userId, msg) {
  const config = getConfig(userId);
  if (!config.enabled)               return;
  if (!isWithinSchedule(config))     return;
  if (msg.fromMe)                    return;

  const chat = await msg.getChat();
  if (chat.isGroup && !config.replyToGroups) return;
  if (isOnCooldown(userId, msg.from, config.cooldownMinutes)) return;

  // Keyword filter — if keywords set, only reply when message matches one
  if (config.keywords && config.keywords.length > 0) {
    const body = (msg.body || "").toLowerCase();
    const matches = config.keywords.some(kw => body.includes(kw));
    if (!matches) return;
  }

  try {
    await msg.reply(config.busyMessage);
    getReplyLog(userId).set(msg.from, Date.now());
    pruneReplyLog(userId, config.cooldownMinutes);
    console.log(`[AutoReply:${userId}] Replied to ${msg.from}`);
  } catch (err) {
    console.error(`[AutoReply:${userId}] Error:`, err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
function getAutoReplyConfig(userId) {
  return { ...getConfig(userId) };
}

function updateAutoReplyConfig(userId, newConfig) {
  const current = getConfig(userId);
  // Deep-merge the nested schedule object to avoid overwriting unset keys
  const merged = {
    ...current,
    ...newConfig,
    schedule: { ...current.schedule, ...(newConfig.schedule || {}) },
    keywords: Array.isArray(newConfig.keywords) ? newConfig.keywords : (current.keywords || []),
  };
  userConfigs.set(userId, merged);
  saveConfig(userId, merged);
  if (!merged.enabled) getReplyLog(userId).clear();
}

module.exports = { handleAutoReply, getAutoReplyConfig, updateAutoReplyConfig };
