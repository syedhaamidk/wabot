const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

function userFile(userId) {
  const dir = path.join(DATA_DIR, userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "templates.json");
}

// ── In-memory cache ──────────────────────────────────────────────────────────
const cache = new Map(); // userId -> Map<id, template>

function load(userId) {
  if (cache.has(userId)) return cache.get(userId);
  const map  = new Map();
  const file = userFile(userId);
  if (fs.existsSync(file)) {
    try {
      const items = JSON.parse(fs.readFileSync(file, "utf8"));
      items.forEach(t => map.set(t.id, t));
    } catch(e) {
      console.error(`[Templates:${userId}] load error:`, e.message);
    }
  }
  cache.set(userId, map);
  return map;
}

function save(userId) {
  const data = Array.from(load(userId).values());
  fs.writeFileSync(userFile(userId), JSON.stringify(data, null, 2));
}

// ── Public API ───────────────────────────────────────────────────────────────

/** List all templates for a user, sorted by name. */
function getTemplates(userId) {
  return Array.from(load(userId).values())
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Get a single template by id. Returns null if not found. */
function getTemplate(userId, id) {
  return load(userId).get(id) || null;
}

/**
 * Create a new template.
 * @param {string} userId
 * @param {string} name  - short display name (max 60 chars)
 * @param {string} body  - message body (max 4096 chars)
 * @returns template object or { error }
 */
function createTemplate(userId, name, body) {
  name = (name || "").trim();
  body = (body || "").trim();
  if (!name)            return { error: "Template name is required." };
  if (name.length > 60) return { error: "Name must be 60 characters or fewer." };
  if (!body)            return { error: "Template body is required." };
  if (body.length > 4096) return { error: "Body must be 4096 characters or fewer." };

  const templates = load(userId);
  // Prevent duplicate names
  const duplicate = Array.from(templates.values()).find(t => t.name.toLowerCase() === name.toLowerCase());
  if (duplicate) return { error: "A template with that name already exists." };

  const template = {
    id:        crypto.randomUUID(),
    name,
    body,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0,
  };
  templates.set(template.id, template);
  save(userId);
  return template;
}

/**
 * Update an existing template's name and/or body.
 * @returns updated template or { error } or null if not found
 */
function updateTemplate(userId, id, { name, body }) {
  const templates = load(userId);
  const existing  = templates.get(id);
  if (!existing) return null;

  name = (name || existing.name).trim();
  body = (body || existing.body).trim();

  if (!name)              return { error: "Template name is required." };
  if (name.length > 60)   return { error: "Name must be 60 characters or fewer." };
  if (!body)              return { error: "Template body is required." };
  if (body.length > 4096) return { error: "Body must be 4096 characters or fewer." };

  // Prevent duplicate names (excluding self)
  const duplicate = Array.from(templates.values())
    .find(t => t.id !== id && t.name.toLowerCase() === name.toLowerCase());
  if (duplicate) return { error: "A template with that name already exists." };

  const updated = { ...existing, name, body, updatedAt: new Date().toISOString() };
  templates.set(id, updated);
  save(userId);
  return updated;
}

/** Delete a template. Returns true or null if not found. */
function deleteTemplate(userId, id) {
  const templates = load(userId);
  if (!templates.has(id)) return null;
  templates.delete(id);
  save(userId);
  return true;
}

/**
 * Increment usage count — call this when a template is used to send a message.
 * Returns silently if the template doesn't exist.
 */
function recordUsage(userId, id) {
  const templates = load(userId);
  const t = templates.get(id);
  if (!t) return;
  templates.set(id, { ...t, usageCount: (t.usageCount || 0) + 1, lastUsedAt: new Date().toISOString() });
  save(userId);
}

module.exports = {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  recordUsage,
};
