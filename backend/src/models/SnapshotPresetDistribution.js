const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const SnapshotPresetDistribution = sequelize.define(
  "SnapshotPresetDistribution",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    snapshotId: { type: DataTypes.INTEGER, allowNull: false },
    preset: { type: DataTypes.STRING, allowNull: false },
    label: DataTypes.STRING,
    draftRows: DataTypes.INTEGER,
    qaRows: DataTypes.INTEGER,
    totalRows: DataTypes.INTEGER,
    totalHours: DataTypes.FLOAT,
  },
  {
    tableName: "snapshot_preset_distribution",
    timestamps: false,
    indexes: [{ fields: ["snapshotId"] }],
  }
);

module.exports = { SnapshotPresetDistribution };
