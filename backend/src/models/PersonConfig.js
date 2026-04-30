const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");
const { jsonColumn } = require("./_jsonColumn");

const PersonConfig = sequelize.define(
  "PersonConfig",
  {
    /** Original capitalized name (e.g. "María Vásquez"). Used as primary key
     *  to match the existing localStorage shape (Record<name, config>). */
    name: { type: DataTypes.STRING(255), primaryKey: true },
    level: { type: DataTypes.STRING(32), allowNull: true },
    primaryRole: { type: DataTypes.STRING(32), allowNull: true },
    functions: jsonColumn("functions", { allowNull: false, defaultValue: [] }),
    isTeamLead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    updatedBy: { type: DataTypes.STRING(255), allowNull: true },
  },
  {
    tableName: "person_config",
    timestamps: true,
  }
);

module.exports = { PersonConfig };
