const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const SnapshotTeam = sequelize.define(
  "SnapshotTeam",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    snapshotId: { type: DataTypes.INTEGER, allowNull: false },
    team: { type: DataTypes.STRING, allowNull: false },
    draftFiles: DataTypes.INTEGER,
    draftHours: DataTypes.FLOAT,
    draftRate: DataTypes.FLOAT,
    qer: DataTypes.FLOAT,
    qaFiles: DataTypes.INTEGER,
    qaHours: DataTypes.FLOAT,
    qaRate: DataTypes.FLOAT,
  },
  {
    tableName: "snapshot_teams",
    timestamps: false,
    indexes: [{ fields: ["snapshotId"] }],
  }
);

module.exports = { SnapshotTeam };
