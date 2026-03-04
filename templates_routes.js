// ═══════════════════════════════════════════════════════════════════════════
// STEP 1 — Add this require() near the top of index.js with your other imports
// ═══════════════════════════════════════════════════════════════════════════
const {
  getTemplates, getTemplate,
  createTemplate, updateTemplate,
  deleteTemplate, recordUsage,
} = require("./templates");


// ═══════════════════════════════════════════════════════════════════════════
// STEP 2 — Paste these routes into index.js, after the auto-reply routes
//           and before the "Start" block at the bottom.
// ═══════════════════════════════════════════════════════════════════════════

// ── Templates ────────────────────────────────────────────────────────────────

// GET /api/templates
// Returns all templates for the authenticated user, sorted by name.
app.get("/api/templates", (req, res) => {
  res.json(getTemplates(req.user.id));
});

// GET /api/templates/:id
// Returns a single template.
app.get("/api/templates/:id", (req, res) => {
  const t = getTemplate(req.user.id, req.params.id);
  if (!t) return res.status(404).json({ error: "Template not found." });
  res.json(t);
});

// POST /api/templates
// Create a new template.
// Body: { name: string, body: string }
app.post("/api/templates", (req, res) => {
  const { name, body } = req.body;
  if (!name || !body)
    return res.status(400).json({ error: "name and body are required." });
  const result = createTemplate(req.user.id, name, body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json({ success: true, template: result });
});

// PATCH /api/templates/:id
// Update an existing template's name and/or body.
// Body: { name?: string, body?: string }
app.patch("/api/templates/:id", (req, res) => {
  const { name, body } = req.body;
  if (!name && !body)
    return res.status(400).json({ error: "Provide name and/or body to update." });
  const result = updateTemplate(req.user.id, req.params.id, { name, body });
  if (result === null) return res.status(404).json({ error: "Template not found." });
  if (result.error)   return res.status(400).json(result);
  res.json({ success: true, template: result });
});

// DELETE /api/templates/:id
// Delete a template permanently.
app.delete("/api/templates/:id", (req, res) => {
  const result = deleteTemplate(req.user.id, req.params.id);
  if (!result) return res.status(404).json({ error: "Template not found." });
  res.json({ success: true });
});

// POST /api/templates/:id/use
// Record that a template was used (increments usageCount).
// Call this from the frontend whenever a template is selected to send a message.
app.post("/api/templates/:id/use", (req, res) => {
  const t = getTemplate(req.user.id, req.params.id);
  if (!t) return res.status(404).json({ error: "Template not found." });
  recordUsage(req.user.id, req.params.id);
  res.json({ success: true, body: t.body });
});
