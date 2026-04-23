const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");
const { jsonColumn } = require("./_jsonColumn");

const UploadRow = sequelize.define(
  "UploadRow",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    batchId: { type: DataTypes.STRING, allowNull: false },
    rowIndex: { type: DataTypes.INTEGER, allowNull: false },
    data: jsonColumn("data", { allowNull: false }),
  },
  {
    tableName: "upload_rows",
    timestamps: false,
    indexes: [{ fields: ["batchId"] }],
  }
);

module.exports = { UploadRow };
