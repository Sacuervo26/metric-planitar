const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");
const { jsonColumn } = require("./_jsonColumn");

/**
 * One row per uploaded schedule .xlsx file. The full set of months and
 * person-by-person events is stored as JSON inside the row so we don't have
 * to denormalize hundreds of small tables.
 */
const ScheduleBatch = sequelize.define(
  "ScheduleBatch",
  {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    fileName: { type: DataTypes.STRING(255), allowNull: false },
    uploadedAt: { type: DataTypes.STRING(64), allowNull: false },
    months: jsonColumn("months", { allowNull: false, defaultValue: [] }),
    updatedBy: { type: DataTypes.STRING(255), allowNull: true },
  },
  {
    tableName: "schedule_batches",
    timestamps: true,
  }
);

module.exports = { ScheduleBatch };
