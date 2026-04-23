const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const SnapshotWeeklyRow = sequelize.define(
  "SnapshotWeeklyRow",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    snapshotId: { type: DataTypes.INTEGER, allowNull: false },
    weekLabel: DataTypes.STRING,
    firstDay: DataTypes.STRING,
    lastDay: DataTypes.STRING,
    fileCount: DataTypes.INTEGER,
    propertySF: DataTypes.FLOAT,
    time: DataTypes.FLOAT,
    avgDraftRate: DataTypes.FLOAT,
    avgQER: DataTypes.FLOAT,
    avgL1: DataTypes.FLOAT,
    avgL2: DataTypes.FLOAT,
    avgL3: DataTypes.FLOAT,
    qaFiles: DataTypes.INTEGER,
    qaPropertySF: DataTypes.FLOAT,
    qaTime: DataTypes.FLOAT,
    avgQARate: DataTypes.FLOAT,
    isTotal: DataTypes.BOOLEAN,
  },
  {
    tableName: "snapshot_weekly_rows",
    timestamps: false,
    indexes: [{ fields: ["snapshotId"] }],
  }
);

module.exports = { SnapshotWeeklyRow };
