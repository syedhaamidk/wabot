// scheduler.js - Scheduled message logic
const scheduledMessages = new Map();

function scheduleMessage(client, { recipient, message, sendAt }) {
  const id = require("crypto").randomUUID();
  const delay = new Date(sendAt).getTime() - Date.now();

  const timeout = setTimeout(async () => {
    try {
      const chatId = recipient.includes("@") ? recipient : recipient.replace(/[^0-9]/g, "") + "@c.us";
      await client.sendMessage(chatId, message);
      console.log("[Scheduler] Sent to " + recipient);
    } catch (err) {
      console.error("[Scheduler] Failed:", err.message);
    } finally {
      scheduledMessages.delete(id);
    }
  }, delay);

  const job = { id, recipient, message, sendAt: new Date(sendAt).toISOString(), status: "pending" };
  scheduledMessages.set(id, { ...job, timeout });
  return job;
}

function cancelScheduledMessage(id) {
  const job = scheduledMessages.get(id);
  if (!job) return null;
  clearTimeout(job.timeout);
  scheduledMessages.delete(id);
  return true;
}

function getScheduledMessages() {
  return Array.from(scheduledMessages.values()).map(({ timeout, ...job }) => job);
}

module.exports = { scheduleMessage, cancelScheduledMessage, getScheduledMessages };
