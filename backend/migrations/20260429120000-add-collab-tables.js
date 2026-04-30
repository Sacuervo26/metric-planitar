"use strict";

const isSqlite = (process.env.DB_DIALECT || "sqlite") === "sqlite";

function jsonType(Sequelize) {
  return isSqlite ? Sequelize.TEXT : Sequelize.JSONB;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("manual_day_adjustments", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      normalizedPersonName: { type: Sequelize.STRING(255), allowNull: false },
      isoDate: { type: Sequelize.STRING(10), allowNull: false },
      entries: { type: jsonType(Sequelize), allowNull: false },
      totalHours: { type: Sequelize.FLOAT, allowNull: false, defaultValue: 0 },
      updatedBy: { type: Sequelize.STRING(255), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("manual_day_adjustments", {
      fields: ["normalizedPersonName", "isoDate"],
      unique: true,
      name: "manual_day_adjustments_person_date_unique",
    });
    await queryInterface.addIndex("manual_day_adjustments", {
      fields: ["normalizedPersonName"],
      name: "manual_day_adjustments_person_idx",
    });
    await queryInterface.addIndex("manual_day_adjustments", {
      fields: ["isoDate"],
      name: "manual_day_adjustments_iso_date_idx",
    });

    await queryInterface.createTable("schedule_batches", {
      id: {
        type: Sequelize.STRING(64),
        primaryKey: true,
        allowNull: false,
      },
      fileName: { type: Sequelize.STRING(255), allowNull: false },
      uploadedAt: { type: Sequelize.STRING(64), allowNull: false },
      months: { type: jsonType(Sequelize), allowNull: false },
      updatedBy: { type: Sequelize.STRING(255), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable("person_config", {
      name: {
        type: Sequelize.STRING(255),
        primaryKey: true,
        allowNull: false,
      },
      level: { type: Sequelize.STRING(32), allowNull: true },
      primaryRole: { type: Sequelize.STRING(32), allowNull: true },
      functions: { type: jsonType(Sequelize), allowNull: false },
      isTeamLead: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      updatedBy: { type: Sequelize.STRING(255), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("person_config");
    await queryInterface.dropTable("schedule_batches");
    await queryInterface.dropTable("manual_day_adjustments");
  },
};
