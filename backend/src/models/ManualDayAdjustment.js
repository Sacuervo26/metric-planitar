const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");
const { jsonColumn } = require("./_jsonColumn");

const ManualDayAdjustment = sequelize.define(
  "ManualDayAdjustment",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    normalizedPersonName: { type: DataTypes.STRING(255), allowNull: false },
    isoDate: { type: DataTypes.STRING(10), allowNull: false },
    /** Array of { id, hours, note }. */
    entries: jsonColumn("entries", { allowNull: false, defaultValue: [] }),
    /** Mirror of total hours for backward compatibility / fast queries. */
    totalHours: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    /** Free-form name of the editor (no auth — just a label). */
    updatedBy: { type: DataTypes.STRING(255), allowNull: true },
  },
  {
    tableName: "manual_day_adjustments",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["normalizedPersonName", "isoDate"] },
      { fields: ["normalizedPersonName"] },
      { fields: ["isoDate"] },
    ],
  }
);

module.exports = { ManualDayAdjustment };
