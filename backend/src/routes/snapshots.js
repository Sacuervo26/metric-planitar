const express = require("express");
const {
  Snapshot,
  SnapshotTeam,
  SnapshotWeeklyRow,
  SnapshotPresetDistribution,
} = require("../models");

const router = express.Router();

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

function parsePagination(query) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const rawOffset = Number.parseInt(query.offset, 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}

function snapshotDetailToApi(s) {
  return {
    id: s.id,
    generatedAt: s.generatedAt,
    preset: s.preset,
    presetLabel: s.presetLabel,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    summary: {
      totalRows: s.summaryTotalRows,
      totalPropertySF: s.summaryTotalPropertySF,
      totalTime: s.summaryTotalTime,
      avgDraftRate: s.summaryAvgDraftRate,
      avgQER: s.summaryAvgQER,
      avgL1: s.summaryAvgL1,
      avgL2: s.summaryAvgL2,
      avgL3: s.summaryAvgL3,
      qaFiles: s.summaryQaFiles,
      qaPropertySF: s.summaryQaPropertySF,
      qaTime: s.summaryQaTime,
      avgQARate: s.summaryAvgQARate,
    },
    teams: s.teams || [],
    weeklyRows: s.weeklyRows || [],
    presetDistribution: s.presetDistribution || [],
    teamComparisonByPreset: s.teamComparisonByPreset ?? null,
    teamMembersByPreset: s.teamMembersByPreset ?? null,
    weeklyTeamsByPreset: s.weeklyTeamsByPreset ?? null,
    teamMembersWeeklyByPreset: s.teamMembersWeeklyByPreset ?? null,
    topDraftersByTeam: s.topDraftersByTeam ?? [],
    topQaByTeam: s.topQaByTeam ?? [],
  };
}

router.get("/", async (req, res, next) => {
  try {
    const { limit, offset } = parsePagination(req.query);

    const { rows, count } = await Snapshot.findAndCountAll({
      attributes: [
        "id",
        "generatedAt",
        "preset",
        "presetLabel",
        "summaryTotalRows",
        "summaryTotalTime",
        "createdAt",
        "updatedAt",
      ],
      order: [["updatedAt", "DESC"]],
      limit,
      offset,
    });

    res.json({
      total: count,
      limit,
      offset,
      items: rows.map((s) => ({
        id: s.id,
        generatedAt: s.generatedAt,
        preset: s.preset,
        presetLabel: s.presetLabel,
        totalRows: s.summaryTotalRows,
        totalTime: s.summaryTotalTime,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const snapshot = await Snapshot.findByPk(id, {
      include: [
        { model: SnapshotTeam, as: "teams" },
        { model: SnapshotWeeklyRow, as: "weeklyRows" },
        { model: SnapshotPresetDistribution, as: "presetDistribution" },
      ],
    });

    if (!snapshot) {
      return res.status(404).json({ error: "Snapshot not found" });
    }

    res.json(snapshotDetailToApi(snapshot));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
