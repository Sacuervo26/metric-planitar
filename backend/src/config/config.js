require("dotenv").config();
const path = require("path");

const dialect = process.env.DB_DIALECT || "sqlite";

function sqliteConfig() {
  const defaultStorage = path.resolve(__dirname, "..", "..", "data", "metric-planitar.sqlite");
  return {
    dialect: "sqlite",
    storage: process.env.DB_STORAGE
      ? path.resolve(process.env.DB_STORAGE)
      : defaultStorage,
    logging: false,
  };
}

function networkedConfig() {
  return {
    dialect,
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || undefined,
    database: process.env.DB_NAME,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    logging: false,
  };
}

const base = dialect === "sqlite" ? sqliteConfig() : networkedConfig();

module.exports = {
  development: base,
  test: base,
  production: base,
};
