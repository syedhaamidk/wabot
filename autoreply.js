const fs = require("fs");
const path = require("path");

const defaultConfig = () => ({
  enabled: false,
  busyMessage: "Hey! I am currently busy and will get back to you soon.",
  schedule: { enabled: false, startTime: "22:00", endTime: "08:00" },
  cooldownMinutes: 60,
  replyToGroups: false
});

const userConfigs  = new Map(); // userId -> config
const userReplyLog = new Map(); // userId -> Map<chatId, timestamp>

function getConfig(userId) {
  if (!userConfigs.has(userId)) {
    // Try loading from disk
    const file = path.join(__dirname, "data", userId, "autoreply.json");
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
  const dir = path.join(__dirname, "data", userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "autoreply.json"), JSON.stringify(config, null, 2));
}

function getReplyLog(userId) {
  if (!userReplyLog.has(userId)) userReplyLog.set(userId, new Map());
  return userReplyLog.get(userId);
}

function isWithinSchedule(config) {
  if (!config.schedule.enabled) return true;
  const now = new Date();
  const [startH, startM] = config.schedule.startTime.split(":").map(Number);
  const [endH,   endM  ] = config.schedule.endTime.split(":").map(Number);
  const cur   = now.getHours() * 60 + now.getMinutes();
  const start = startH * 60 + startM;
  const end   = endH   * 60 + endM;
  if (start > end) return cur >= start || cur < end;
  return cur >= start && cur < end;
}

function isOnCooldown(userId, chatId, cooldownMinutes) {
  const last = getReplyLog(userId).get(chatId);
  if (!last) return false;
  return (Date.now() - last) / 60000 < cooldownMinutes;
}

async function handleAutoReply(client, userId, msg) {
  const config = getConfig(userId);
  if (!config.enabled) return;
  if (!isWithinSchedule(config)) return;
  const chat = await msg.getChat();
  if (chat.isGroup && !config.replyToGroups) return;
  if (msg.fromMe) return;
  if (isOnCooldown(userId, msg.from, config.cooldownMinutes)) return;
  try {
    await msg.reply(config.busyMessage);
    getReplyLog(userId).set(msg.from, Date.now());
    console.log(`[AutoReply:${userId}] Replied to ${msg.from}`);
  } catch (err) {
    console.error(`[AutoReply:${userId}] Error:`, err.message);
  }
}

function getAutoReplyConfig(userId) {
  return { ...getConfig(userId) };
}

function updateAutoReplyConfig(userId, newConfig) {
  const merged = { ...getConfig(userId), ...newConfig };
  userConfigs.set(userId, merged);
  saveConfig(userId, merged);
  if (!newConfig.enabled) getReplyLog(userId).clear();
}

module.exports = { handleAutoReply, getAutoReplyConfig, updateAutoReplyConfig };
