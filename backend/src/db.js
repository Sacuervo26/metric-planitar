const { Sequelize } = require("sequelize");
const path = require("path");
const fs = require("fs");

const dialect = process.env.DB_DIALECT || "sqlite";

let sequelize;

if (dialect === "sqlite") {
  const storage = process.env.DB_STORAGE || "./data/metric-planitar.sqlite";
  const dir = path.dirname(storage);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  sequelize = new Sequelize({
    dialect: "sqlite",
    storage,
    logging: false,
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
