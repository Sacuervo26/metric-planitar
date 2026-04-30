const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
      set(value) {
        // Always store lowercased and trimmed so login matches case-insensitively.
        this.setDataValue(
          "email",
          typeof value === "string" ? value.trim().toLowerCase() : value
        );
      },
    },
    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    displayName: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    normalizedPersonName: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    team: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    role: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: "member",
      validate: {
        isIn: [["leader", "member"]],
      },
    },
    bio: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    photoDataUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    coverDataUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    mustChangePassword: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastActiveAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "users",
    timestamps: true,
  }
);

// Strip sensitive fields when serializing to JSON for API responses.
User.prototype.toPublicJSON = function toPublicJSON() {
  const plain = this.get({ plain: true });
  delete plain.passwordHash;
  return plain;
};

module.exports = { User };
