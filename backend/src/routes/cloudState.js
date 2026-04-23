const express = require("express");
const { sequelize } = require("../db");
const {
  Snapshot,
  SnapshotTeam,
  SnapshotWeeklyRow,
  SnapshotPresetDistribution,
  UploadBatch,
  UploadRow,
} = require("../models");
const { validateCloudState } = require("../middleware/validate");

const router = express.Router();

const REGIONS = ["standard", "australia"];

function snapshotToApi(snapshot) {
  if (!snapshot) return null;
  const teams = (snapshot.teams || []).map((t) => ({
    team: t.team,
    draftFiles: t.draftFiles,
    draftHours: t.draftHours,
    draftRate: t.draftRate,
    qer: t.qer,
    qaFiles: t.qaFiles,
    qaHours: t.qaHours,
    qaRate: t.qaRate,
  }));
  const weeklyRows = (snapshot.weeklyRows || []).map((w) => ({
    weekLabel: w.weekLabel,
    firstDay: w.firstDay,
    lastDay: w.lastDay,
    fileCount: w.fileCount,
    propertySF: w.propertySF,
    time: w.time,
    avgDraftRate: w.avgDraftRate,
    avgQER: w.avgQER,
    avgL1: w.avgL1,
    avgL2: w.avgL2,
    avgL3: w.avgL3,
    qaFiles: w.qaFiles,
    qaPropertySF: w.qaPropertySF,
    qaTime: w.qaTime,
    avgQARate: w.avgQARate,
    ...(w.isTotal ? { isTotal: true } : {}),
  }));
  const presetDistribution = (snapshot.presetDistribution || []).map((p) => ({
    preset: p.preset,
    label: p.label,
    draftRows: p.draftRows,
    qaRows: p.qaRows,
    totalRows: p.totalRows,
    totalHours: p.totalHours,
  }));

  return {
    generatedAt: snapshot.generatedAt,
    preset: snapshot.preset,
    presetLabel: snapshot.presetLabel,
    summary: {
      totalRows: snapshot.summaryTotalRows,
      totalPropertySF: snapshot.summaryTotalPropertySF,
      totalTime: snapshot.summaryTotalTime,
      avgDraftRate: snapshot.summaryAvgDraftRate,
      avgQER: snapshot.summaryAvgQER,
      avgL1: snapshot.summaryAvgL1,
      avgL2: snapshot.summaryAvgL2,
      avgL3: snapshot.summaryAvgL3,
      qaFiles: snapshot.summaryQaFiles,
      qaPropertySF: snapshot.summaryQaPropertySF,
      qaTime: snapshot.summaryQaTime,
      avgQARate: snapshot.summaryAvgQARate,
    },
    teams,
    teamComparisonByPreset: snapshot.teamComparisonByPreset ?? undefined,
    teamMembersByPreset: snapshot.teamMembersByPreset ?? undefined,
    weeklyTeamsByPreset: snapshot.weeklyTeamsByPreset ?? undefined,
    teamMembersWeeklyByPreset: snapshot.teamMembersWeeklyByPreset ?? undefined,
    weeklyRows,
    topDraftersByTeam: snapshot.topDraftersByTeam ?? [],
    topQaByTeam: snapshot.topQaByTeam ?? [],
    presetDistribution,
  };
}

async function loadBatches() {
  const rows = await UploadBatch.findAll({
    include: [{ model: UploadRow, as: "rows" }],
    order: [
      ["uploadedAt", "ASC"],
      [{ model: UploadRow, as: "rows" }, "rowIndex", "ASC"],
    ],
  });

  const grouped = { standard: [], australia: [] };
  for (const b of rows) {
    grouped[b.region].push({
      id: b.id,
      fileName: b.fileName,
      uploadedAt: b.uploadedAt,
      rowCount: b.rowCount,
      rows: (b.rows || []).map((r) => r.data),
    });
  }
  return grouped;
}

router.get("/", async (_req, res, next) => {
  try {
    const latest = await Snapshot.findOne({
      order: [["updatedAt", "DESC"]],
      include: [
        { model: SnapshotTeam, as: "teams" },
        { model: SnapshotWeeklyRow, as: "weeklyRows" },
        { model: SnapshotPresetDistribution, as: "presetDistribution" },
      ],
    });

    const batches = await loadBatches();

    const state = {
      snapshot: snapshotToApi(latest),
      batches: {
        ...batches,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: latest ? latest.updatedAt.toISOString() : new Date().toISOString(),
    };

    res.json({ configured: true, state });
  } catch (err) {
    next(err);
  }
});

router.post("/", validateCloudState, async (req, res, next) => {
  const payload = req.body;

  const t = await sequelize.transaction();
  try {
    const snap = payload.snapshot;
    if (snap) {
      const created = await Snapshot.create(
        {
          generatedAt: snap.generatedAt,
          preset: snap.preset,
          presetLabel: snap.presetLabel,
          summaryTotalRows: snap.summary?.totalRows,
          summaryTotalPropertySF: snap.summary?.totalPropertySF,
          summaryTotalTime: snap.summary?.totalTime,
          summaryAvgDraftRate: snap.summary?.avgDraftRate,
          summaryAvgQER: snap.summary?.avgQER,
          summaryAvgL1: snap.summary?.avgL1,
          summaryAvgL2: snap.summary?.avgL2,
          summaryAvgL3: snap.summary?.avgL3,
          summaryQaFiles: snap.summary?.qaFiles,
          summaryQaPropertySF: snap.summary?.qaPropertySF,
          summaryQaTime: snap.summary?.qaTime,
          summaryAvgQARate: snap.summary?.avgQARate,
          teamComparisonByPreset: snap.teamComparisonByPreset ?? null,
          teamMembersByPreset: snap.teamMembersByPreset ?? null,
          weeklyTeamsByPreset: snap.weeklyTeamsByPreset ?? null,
          teamMembersWeeklyByPreset: snap.teamMembersWeeklyByPreset ?? null,
          topDraftersByTeam: snap.topDraftersByTeam ?? [],
          topQaByTeam: snap.topQaByTeam ?? [],
        },
        { transaction: t }
      );

      if (Array.isArray(snap.teams) && snap.teams.length) {
        await SnapshotTeam.bulkCreate(
          snap.teams.map((r) => ({ ...r, snapshotId: created.id })),
          { transaction: t }
        );
      }
      if (Array.isArray(snap.weeklyRows) && snap.weeklyRows.length) {
        await SnapshotWeeklyRow.bulkCreate(
          snap.weeklyRows.map((r) => ({
            ...r,
            isTotal: Boolean(r.isTotal),
            snapshotId: created.id,
          })),
          { transaction: t }
        );
      }
      if (
        Array.isArray(snap.presetDistribution) &&
        snap.presetDistribution.length
      ) {
        await SnapshotPresetDistribution.bulkCreate(
          snap.presetDistribution.map((r) => ({
            ...r,
            snapshotId: created.id,
          })),
          { transaction: t }
        );
      }
    }

    // Replace batches wholesale — mirrors current JSON-blob semantics.
    await UploadRow.destroy({ where: {}, transaction: t, truncate: false });
    await UploadBatch.destroy({ where: {}, transaction: t, truncate: false });

    const batches = payload.batches || {};
    for (const region of REGIONS) {
      const list = Array.isArray(batches[region]) ? batches[region] : [];
      for (const batch of list) {
        await UploadBatch.create(
          {
            id: batch.id,
            region,
            fileName: batch.fileName,
            uploadedAt: batch.uploadedAt,
            rowCount: batch.rowCount,
          },
          { transaction: t }
        );
        if (Array.isArray(batch.rows) && batch.rows.length) {
          await UploadRow.bulkCreate(
            batch.rows.map((data, rowIndex) => ({
              batchId: batch.id,
              rowIndex,
              data,
            })),
            { transaction: t }
          );
        }
      }
    }

    await t.commit();
  } catch (err) {
    await t.rollback();
    return next(err);
  }

  // Reassemble from DB so client sees canonical state.
  try {
    const latest = await Snapshot.findOne({
      order: [["updatedAt", "DESC"]],
      include: [
        { model: SnapshotTeam, as: "teams" },
        { model: SnapshotWeeklyRow, as: "weeklyRows" },
        { model: SnapshotPresetDistribution, as: "presetDistribution" },
      ],
    });
    const batches = await loadBatches();

    res.json({
      configured: true,
      state: {
        snapshot: snapshotToApi(latest),
        batches: {
          ...batches,
          updatedAt: payload.batches?.updatedAt || new Date().toISOString(),
        },
        updatedAt: latest
          ? latest.updatedAt.toISOString()
          : new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
