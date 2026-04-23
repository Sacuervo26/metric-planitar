const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const UploadBatch = sequelize.define(
  "UploadBatch",
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    region: {
      type: DataTypes.ENUM("standard", "australia"),
      allowNull: false,
    },
    fileName: { type: DataTypes.STRING, allowNull: false },
    uploadedAt: { type: DataTypes.STRING, allowNull: false },
    rowCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  {
    tableName: "upload_batches",
    timestamps: true,
    indexes: [{ fields: ["region"] }, { fields: ["uploadedAt"] }],
  }
);

module.exports = { UploadBatch };
