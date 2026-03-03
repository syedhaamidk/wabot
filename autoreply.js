let config = {
  enabled: false,
  busyMessage: "Hey! I am currently busy and will get back to you soon.",
  schedule: { enabled: false, startTime: "22:00", endTime: "08:00" },
  cooldownMinutes: 60,
  replyToGroups: false
};

const replyLog = new Map();

function isWithinSchedule() {
  if (!config.schedule.enabled) return true;
  const now = new Date();
  const [startH, startM] = config.schedule.startTime.split(":").map(Number);
  const [endH, endM] = config.schedule.endTime.split(":").map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  if (start > end) return cur >= start || cur < end;
  return cur >= start && cur < end;
}

function isOnCooldown(chatId) {
  const last = replyLog.get(chatId);
  if (!last) return false;
  return (Date.now() - last) / 60000 < config.cooldownMinutes;
}

async function handleAutoReply(client, msg) {
  if (!config.enabled) return;
  if (!isWithinSchedule()) return;
  const chat = await msg.getChat();
  if (chat.isGroup && !config.replyToGroups) return;
  if (msg.fromMe) return;
  if (isOnCooldown(msg.from)) return;
  try {
    await msg.reply(config.busyMessage);
    replyLog.set(msg.from, Date.now());
    console.log("[AutoReply] Replied to " + msg.from);
  } catch (err) {
    console.error("[AutoReply] Error:", err.message);
  }
}

function getAutoReplyConfig() {
  return { ...config };
}

function updateAutoReplyConfig(newConfig) {
  config = { ...config, ...newConfig };
  if (!newConfig.enabled) replyLog.clear();
}

module.exports = { handleAutoReply, getAutoReplyConfig, updateAutoReplyConfig };