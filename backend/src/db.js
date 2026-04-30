const { Sequelize } = require("sequelize");
const path = require("path");
const fs = require("fs");

const dialect = process.env.DB_DIALECT || "sqlite";
const databaseUrl = process.env.DATABASE_URL;

let sequelize;

if (dialect === "sqlite") {
  const defaultStorage = path.resolve(__dirname, "..", "data", "metric-planitar.sqlite");
  const storage = process.env.DB_STORAGE
    ? path.resolve(process.env.DB_STORAGE)
    : defaultStorage;
  const dir = path.dirname(storage);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  sequelize = new Sequelize({
    dialect: "sqlite",
    storage,
    logging: false,
  });
} else if (databaseUrl) {
  // Hosted providers (Render, Railway, Heroku, etc.) expose a single
  // DATABASE_URL like "postgresql://user:pass@host:port/db". Sequelize can
  // parse it directly. SSL is required for managed Postgres on Render.
  const dialectOptions =
    dialect === "postgres"
      ? {
          ssl: {
            require: true,
            rejectUnauthorized: false,
          },
        }
      : undefined;

  sequelize = new Sequelize(databaseUrl, {
    dialect,
    logging: false,
    dialectOptions,
  });
} else {
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || undefined,
      dialect,
      logging: false,
    }
  );
}

module.exports = { sequelize };
