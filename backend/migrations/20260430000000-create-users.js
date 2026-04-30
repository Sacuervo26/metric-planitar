"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("users", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      passwordHash: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      displayName: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      // Lowercase + accent-stripped version of the team-roster name. Used to
      // match this account with the rows in the metrics CSV / schedule xlsx.
      normalizedPersonName: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      team: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      role: {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: "member",
      },
      bio: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      // Base64 data URL of the user's avatar. Kept inline for simplicity;
      // ~40 small avatars at 50KB each is ~2MB total.
      photoDataUrl: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      mustChangePassword: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      lastLoginAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      lastActiveAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex("users", {
      fields: ["email"],
      unique: true,
      name: "users_email_unique",
    });

    await queryInterface.addIndex("users", {
      fields: ["normalizedPersonName"],
      name: "users_normalized_person_name_idx",
    });

    await queryInterface.addIndex("users", {
      fields: ["role"],
      name: "users_role_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("users");
  },
};
