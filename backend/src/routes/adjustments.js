const express = require("express");
const { ManualDayAdjustment } = require("../models");

const router = express.Router();

function serialize(row) {
  return {
    normalizedPersonName: row.normalizedPersonName,
    isoDate: row.isoDate,
    entries: row.entries ?? [],
    totalHours: Number(row.totalHours ?? 0),
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

function normalizeEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) return [];
  return rawEntries
    .map((entry) => {
      const hours = Number(entry?.hours);
      const note = String(entry?.note ?? "").trim();
      const id = String(entry?.id ?? "").trim() || cryptoId();
      return {
        id,
        hours: Number.isFinite(hours) && hours > 0 ? hours : 0,
        note,
      };
    })
    .filter((entry) => entry.hours > 0 || entry.note.length > 0);
}

function cryptoId() {
  return `srv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// List all adjustments (optionally for one person).
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    const person = String(req.query.person ?? "").trim();
    if (person) where.normalizedPersonName = person;
    const rows = await ManualDayAdjustment.findAll({
      where,
      order: [["normalizedPersonName", "ASC"], ["isoDate", "ASC"]],
    });
    res.json({ adjustments: rows.map(serialize) });
  } catch (err) {
    next(err);
  }
});

// Upsert a single (person, date) adjustment.
router.put("/", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const normalizedPersonName = String(body.normalizedPersonName ?? "").trim();
    const isoDate = String(body.isoDate ?? "").trim();
    if (!normalizedPersonName || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      return res.status(400).json({ error: "Invalid normalizedPersonName or isoDate" });
    }
    const entries = normalizeEntries(body.entries);
    const totalHours = entries.reduce((s, e) => s + e.hours, 0);
    const updatedBy = body.updatedBy ? String(body.updatedBy).trim() : null;

    if (entries.length === 0) {
      const removed = await ManualDayAdjustment.destroy({
        where: { normalizedPersonName, isoDate },
      });
      return res.json({ removed: removed > 0, normalizedPersonName, isoDate });
    }

    const [row, created] = await ManualDayAdjustment.findOrCreate({
      where: { normalizedPersonName, isoDate },
      defaults: { entries, totalHours, updatedBy },
    });
    if (!created) {
      row.entries = entries;
      row.totalHours = totalHours;
      row.updatedBy = updatedBy;
      await row.save();
    }
    res.json({ adjustment: serialize(row) });
  } catch (err) {
    next(err);
  }
});

// Bulk push from a client (used during local → cloud migration).
router.post("/bulk", async (req, res, next) => {
  try {
    const items = Array.isArray(req.body?.adjustments) ? req.body.adjustments : [];
    let written = 0;
    for (const item of items) {
      const normalizedPersonName = String(item.normalizedPersonName ?? "").trim();
      const isoDate = String(item.isoDate ?? "").trim();
      if (!normalizedPersonName || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) continue;
      const entries = normalizeEntries(item.entries);
      const totalHours = entries.reduce((s, e) => s + e.hours, 0);
      const updatedBy = item.updatedBy ? String(item.updatedBy).trim() : null;

      if (entries.length === 0) {
        await ManualDayAdjustment.destroy({
          where: { normalizedPersonName, isoDate },
        });
        continue;
      }
      const [row, created] = await ManualDayAdjustment.findOrCreate({
        where: { normalizedPersonName, isoDate },
        defaults: { entries, totalHours, updatedBy },
      });
      if (!created) {
        row.entries = entries;
        row.totalHours = totalHours;
        row.updatedBy = updatedBy;
        await row.save();
      }
      written += 1;
    }
    res.json({ written });
  } catch (err) {
    next(err);
  }
});

router.delete("/", async (req, res, next) => {
  try {
    const normalizedPersonName = String(req.query.person ?? "").trim();
    const isoDate = String(req.query.date ?? "").trim();
    if (!normalizedPersonName || !isoDate) {
      return res.status(400).json({ error: "Missing person or date" });
    }
    const removed = await ManualDayAdjustment.destroy({
      where: { normalizedPersonName, isoDate },
    });
    res.json({ removed });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
