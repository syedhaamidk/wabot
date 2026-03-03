const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "scheduled.json");
const scheduledMessages = new Map();

function saveToFile() {
  const data = Array.from(scheduledMessages.values()).map(({ timeout, ...job }) => job);
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function scheduleMessage(client, { recipient, message, sendAt }) {
  const id = require("crypto").randomUUID();
  const sendTime = new Date(sendAt);
  const delay = sendTime.getTime() - Date.now();

  const timeout = setTimeout(async () => {
    try {
      const chatId = recipient.includes("@") ? recipient : recipient.replace(/[^0-9]/g, "") + "@c.us";
      await client.sendMessage(chatId, message);
      console.log("[Scheduler] Sent to " + recipient);
    } catch (err) {
      console.error("[Scheduler] Failed:", err.message);
    } finally {
      scheduledMessages.delete(id);
      saveToFile();
    }
  }, delay);

  const job = { id, recipient, message, sendAt: sendTime.toISOString(), status: "pending" };
  scheduledMessages.set(id, { ...job, timeout });
  saveToFile();
  return job;
}

function cancelScheduledMessage(id) {
  const job = scheduledMessages.get(id);
  if (!job) return null;
  clearTimeout(job.timeout);
  scheduledMessages.delete(id);
  saveToFile();
  return true;
}

function getScheduledMessages() {
  return Array.from(scheduledMessages.values()).map(({ timeout, ...job }) => job);
}

// Restore jobs on startup
function restoreJobs(client) {
  if (!fs.existsSync(FILE)) return;
  try {
    const jobs = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const now = Date.now();
    jobs.forEach(job => {
      const sendTime = new Date(job.sendAt).getTime();
      if (sendTime > now) {
        // Reschedule
        const timeout = setTimeout(async () => {
          try {
            const chatId = job.recipient.includes("@") ? job.recipient : job.recipient.replace(/[^0-9]/g, "") + "@c.us";
            await client.sendMessage(chatId, job.message);
            console.log("[Scheduler] Sent to " + job.recipient);
          } catch (err) {
            console.error("[Scheduler] Failed:", err.message);
          } finally {
            scheduledMessages.delete(job.id);
            saveToFile();
          }
        }, sendTime - now);
        scheduledMessages.set(job.id, { ...job, timeout });
        console.log("[Scheduler] Restored job for " + job.recipient);
      } else {
        console.log("[Scheduler] Skipping expired job for " + job.recipient);
      }
    });
    saveToFile();
  } catch (e) {
    console.error("[Scheduler] Failed to restore jobs:", e.message);
  }
}

module.exports = { scheduleMessage, cancelScheduledMessage, getScheduledMessages, restoreJobs };