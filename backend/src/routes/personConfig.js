const express = require("express");
const { PersonConfig } = require("../models");

const router = express.Router();

function serialize(row) {
  return {
    name: row.name,
    level: row.level ?? null,
    primaryRole: row.primaryRole ?? null,
    functions: Array.isArray(row.functions) ? row.functions : [],
    isTeamLead: !!row.isTeamLead,
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

router.get("/", async (_req, res, next) => {
  try {
    const rows = await PersonConfig.findAll({ order: [["name", "ASC"]] });
    res.json({ people: rows.map(serialize) });
  } catch (err) {
    next(err);
  }
});

router.put("/", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const name = String(body.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "Missing name" });
    const level = body.level ? String(body.level) : null;
    const primaryRole = body.primaryRole ? String(body.primaryRole) : null;
    const functions = Array.isArray(body.functions) ? body.functions.map(String) : [];
    const isTeamLead = !!body.isTeamLead;
    const updatedBy = body.updatedBy ? String(body.updatedBy).trim() : null;

    const [row, created] = await PersonConfig.findOrCreate({
      where: { name },
      defaults: { level, primaryRole, functions, isTeamLead, updatedBy },
    });
    if (!created) {
      row.level = level;
      row.primaryRole = primaryRole;
      row.functions = functions;
      row.isTeamLead = isTeamLead;
      row.updatedBy = updatedBy;
      await row.save();
    }
    res.json({ person: serialize(row) });
  } catch (err) {
    next(err);
  }
});

router.post("/bulk", async (req, res, next) => {
  try {
    const items = Array.isArray(req.body?.people) ? req.body.people : [];
    const updatedBy = req.body?.updatedBy ? String(req.body.updatedBy).trim() : null;
    let written = 0;
    for (const item of items) {
      const name = String(item.name ?? "").trim();
      if (!name) continue;
      const level = item.level ? String(item.level) : null;
      const primaryRole = item.primaryRole ? String(item.primaryRole) : null;
      const functions = Array.isArray(item.functions) ? item.functions.map(String) : [];
      const isTeamLead = !!item.isTeamLead;
      const [row, created] = await PersonConfig.findOrCreate({
        where: { name },
        defaults: { level, primaryRole, functions, isTeamLead, updatedBy },
      });
      if (!created) {
        row.level = level;
        row.primaryRole = primaryRole;
        row.functions = functions;
        row.isTeamLead = isTeamLead;
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
    const name = String(req.query.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "Missing name" });
    const removed = await PersonConfig.destroy({ where: { name } });
    res.json({ removed });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
