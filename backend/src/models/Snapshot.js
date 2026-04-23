const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");
const { jsonColumn } = require("./_jsonColumn");

const Snapshot = sequelize.define(
  "Snapshot",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    generatedAt: { type: DataTypes.STRING, allowNull: false },
    preset: { type: DataTypes.STRING, allowNull: false },
    presetLabel: { type: DataTypes.STRING, allowNull: false },

    summaryTotalRows: DataTypes.INTEGER,
    summaryTotalPropertySF: DataTypes.FLOAT,
    summaryTotalTime: DataTypes.FLOAT,
    summaryAvgDraftRate: DataTypes.FLOAT,
    summaryAvgQER: DataTypes.FLOAT,
    summaryAvgL1: DataTypes.FLOAT,
    summaryAvgL2: DataTypes.FLOAT,
    summaryAvgL3: DataTypes.FLOAT,
    summaryQaFiles: DataTypes.INTEGER,
    summaryQaPropertySF: DataTypes.FLOAT,
    summaryQaTime: DataTypes.FLOAT,
    summaryAvgQARate: DataTypes.FLOAT,

    teamComparisonByPreset: jsonColumn("teamComparisonByPreset"),
    teamMembersByPreset: jsonColumn("teamMembersByPreset"),
    weeklyTeamsByPreset: jsonColumn("weeklyTeamsByPreset"),
    teamMembersWeeklyByPreset: jsonColumn("teamMembersWeeklyByPreset"),
    topDraftersByTeam: jsonColumn("topDraftersByTeam"),
    topQaByTeam: jsonColumn("topQaByTeam"),
  },
  { tableName: "snapshots", timestamps: true }
);

module.exports = { Snapshot };
