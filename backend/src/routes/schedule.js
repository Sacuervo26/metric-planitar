const express = require("express");
const { ScheduleBatch } = require("../models");

const router = express.Router();

function serialize(row) {
  return {
    id: row.id,
    fileName: row.fileName,
    uploadedAt: row.uploadedAt,
    months: row.months ?? [],
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

router.get("/", async (_req, res, next) => {
  try {
    const rows = await ScheduleBatch.findAll({ order: [["createdAt", "ASC"]] });
    res.json({ batches: rows.map(serialize) });
  } catch (err) {
    next(err);
  }
});

// Replace the entire collection. Frontend sends the full set of batches; we
// upsert each and remove any IDs that aren't present.
router.put("/", async (req, res, next) => {
  try {
    const items = Array.isArray(req.body?.batches) ? req.body.batches : [];
    const updatedBy = req.body?.updatedBy ? String(req.body.updatedBy).trim() : null;
    const incomingIds = new Set();
    for (const item of items) {
      const id = String(item.id ?? "").trim();
      if (!id) continue;
      incomingIds.add(id);
      const fileName = String(item.fileName ?? "").trim();
      const uploadedAt = String(item.uploadedAt ?? new Date().toISOString());
      const months = Array.isArray(item.months) ? item.months : [];
      const [row, created] = await ScheduleBatch.findOrCreate({
        where: { id },
        defaults: { fileName, uploadedAt, months, updatedBy },
      });
      if (!created) {
        row.fileName = fileName;
        row.uploadedAt = uploadedAt;
        row.months = months;
        row.updatedBy = updatedBy;
        await row.save();
      }
    }
    // Remove any batches the client did not include.
    const existing = await ScheduleBatch.findAll({ attributes: ["id"] });
    const removeIds = existing
      .map((r) => r.id)
      .filter((id) => !incomingIds.has(id));
    if (removeIds.length > 0) {
      await ScheduleBatch.destroy({ where: { id: removeIds } });
    }
    const after = await ScheduleBatch.findAll({ order: [["createdAt", "ASC"]] });
    res.json({ batches: after.map(serialize) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing id" });
    const removed = await ScheduleBatch.destroy({ where: { id } });
    res.json({ removed });
  } catch (err) {
    next(err);
  }
});

router.delete("/", async (_req, res, next) => {
  try {
    const removed = await ScheduleBatch.destroy({ where: {}, truncate: true });
    res.json({ removed });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
