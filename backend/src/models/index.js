const { sequelize } = require("../db");
const { Snapshot } = require("./Snapshot");
const { SnapshotTeam } = require("./SnapshotTeam");
const { SnapshotWeeklyRow } = require("./SnapshotWeeklyRow");
const { SnapshotPresetDistribution } = require("./SnapshotPresetDistribution");
const { UploadBatch } = require("./UploadBatch");
const { UploadRow } = require("./UploadRow");
const { ManualDayAdjustment } = require("./ManualDayAdjustment");
const { ScheduleBatch } = require("./ScheduleBatchModel");
const { PersonConfig } = require("./PersonConfig");
const { User } = require("./User");

Snapshot.hasMany(SnapshotTeam, {
  foreignKey: "snapshotId",
  as: "teams",
  onDelete: "CASCADE",
});
SnapshotTeam.belongsTo(Snapshot, { foreignKey: "snapshotId" });

Snapshot.hasMany(SnapshotWeeklyRow, {
  foreignKey: "snapshotId",
  as: "weeklyRows",
  onDelete: "CASCADE",
});
SnapshotWeeklyRow.belongsTo(Snapshot, { foreignKey: "snapshotId" });

Snapshot.hasMany(SnapshotPresetDistribution, {
  foreignKey: "snapshotId",
  as: "presetDistribution",
  onDelete: "CASCADE",
});
SnapshotPresetDistribution.belongsTo(Snapshot, { foreignKey: "snapshotId" });

UploadBatch.hasMany(UploadRow, {
  foreignKey: "batchId",
  as: "rows",
  onDelete: "CASCADE",
});
UploadRow.belongsTo(UploadBatch, { foreignKey: "batchId" });

module.exports = {
  sequelize,
  Snapshot,
  SnapshotTeam,
  SnapshotWeeklyRow,
  SnapshotPresetDistribution,
  UploadBatch,
  UploadRow,
  ManualDayAdjustment,
  ScheduleBatch,
  PersonConfig,
  User,
};
