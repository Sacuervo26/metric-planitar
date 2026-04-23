"use strict";

const isSqlite = (process.env.DB_DIALECT || "sqlite") === "sqlite";

function jsonType(Sequelize) {
  return isSqlite ? Sequelize.TEXT : Sequelize.JSONB;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("snapshots", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      generatedAt: { type: Sequelize.STRING, allowNull: false },
      preset: { type: Sequelize.STRING, allowNull: false },
      presetLabel: { type: Sequelize.STRING, allowNull: false },

      summaryTotalRows: Sequelize.INTEGER,
      summaryTotalPropertySF: Sequelize.FLOAT,
      summaryTotalTime: Sequelize.FLOAT,
      summaryAvgDraftRate: Sequelize.FLOAT,
      summaryAvgQER: Sequelize.FLOAT,
      summaryAvgL1: Sequelize.FLOAT,
      summaryAvgL2: Sequelize.FLOAT,
      summaryAvgL3: Sequelize.FLOAT,
      summaryQaFiles: Sequelize.INTEGER,
      summaryQaPropertySF: Sequelize.FLOAT,
      summaryQaTime: Sequelize.FLOAT,
      summaryAvgQARate: Sequelize.FLOAT,

      teamComparisonByPreset: jsonType(Sequelize),
      teamMembersByPreset: jsonType(Sequelize),
      weeklyTeamsByPreset: jsonType(Sequelize),
      teamMembersWeeklyByPreset: jsonType(Sequelize),
      topDraftersByTeam: jsonType(Sequelize),
      topQaByTeam: jsonType(Sequelize),

      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable("snapshot_teams", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      snapshotId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "snapshots", key: "id" },
        onDelete: "CASCADE",
      },
      team: { type: Sequelize.STRING, allowNull: false },
      draftFiles: Sequelize.INTEGER,
      draftHours: Sequelize.FLOAT,
      draftRate: Sequelize.FLOAT,
      qer: Sequelize.FLOAT,
      qaFiles: Sequelize.INTEGER,
      qaHours: Sequelize.FLOAT,
      qaRate: Sequelize.FLOAT,
    });
    await queryInterface.addIndex("snapshot_teams", ["snapshotId"]);

    await queryInterface.createTable("snapshot_weekly_rows", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      snapshotId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "snapshots", key: "id" },
        onDelete: "CASCADE",
      },
      weekLabel: Sequelize.STRING,
      firstDay: Sequelize.STRING,
      lastDay: Sequelize.STRING,
      fileCount: Sequelize.INTEGER,
      propertySF: Sequelize.FLOAT,
      time: Sequelize.FLOAT,
      avgDraftRate: Sequelize.FLOAT,
      avgQER: Sequelize.FLOAT,
      avgL1: Sequelize.FLOAT,
      avgL2: Sequelize.FLOAT,
      avgL3: Sequelize.FLOAT,
      qaFiles: Sequelize.INTEGER,
      qaPropertySF: Sequelize.FLOAT,
      qaTime: Sequelize.FLOAT,
      avgQARate: Sequelize.FLOAT,
      isTotal: Sequelize.BOOLEAN,
    });
    await queryInterface.addIndex("snapshot_weekly_rows", ["snapshotId"]);

    await queryInterface.createTable("snapshot_preset_distribution", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      snapshotId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "snapshots", key: "id" },
        onDelete: "CASCADE",
      },
      preset: { type: Sequelize.STRING, allowNull: false },
      label: Sequelize.STRING,
      draftRows: Sequelize.INTEGER,
      qaRows: Sequelize.INTEGER,
      totalRows: Sequelize.INTEGER,
      totalHours: Sequelize.FLOAT,
    });
    await queryInterface.addIndex("snapshot_preset_distribution", [
      "snapshotId",
    ]);

    await queryInterface.createTable("upload_batches", {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      region: {
        type: Sequelize.ENUM("standard", "australia"),
        allowNull: false,
      },
      fileName: { type: Sequelize.STRING, allowNull: false },
      uploadedAt: { type: Sequelize.STRING, allowNull: false },
      rowCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("upload_batches", ["region"]);
    await queryInterface.addIndex("upload_batches", ["uploadedAt"]);

    await queryInterface.createTable("upload_rows", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      batchId: {
        type: Sequelize.STRING,
        allowNull: false,
        references: { model: "upload_batches", key: "id" },
        onDelete: "CASCADE",
      },
      rowIndex: { type: Sequelize.INTEGER, allowNull: false },
      data: { type: jsonType(Sequelize), allowNull: false },
    });
    await queryInterface.addIndex("upload_rows", ["batchId"]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("upload_rows");
    await queryInterface.dropTable("upload_batches");
    await queryInterface.dropTable("snapshot_preset_distribution");
    await queryInterface.dropTable("snapshot_weekly_rows");
    await queryInterface.dropTable("snapshot_teams");
    await queryInterface.dropTable("snapshots");

    if ((process.env.DB_DIALECT || "sqlite") !== "sqlite") {
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_upload_batches_region";'
      );
    }
  },
};
