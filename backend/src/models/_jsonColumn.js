const { DataTypes } = require("sequelize");

const isSqlite = (process.env.DB_DIALECT || "sqlite") === "sqlite";

function jsonColumn(fieldName, { allowNull = true, defaultValue } = {}) {
  const def = {
    type: isSqlite ? DataTypes.TEXT : DataTypes.JSONB,
    allowNull,
    get() {
      const raw = this.getDataValue(fieldName);
      if (!isSqlite) return raw;
      try {
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    set(value) {
      this.setDataValue(
        fieldName,
        isSqlite && value != null ? JSON.stringify(value) : value
      );
    },
  };
  if (defaultValue !== undefined) {
    def.defaultValue = isSqlite ? JSON.stringify(defaultValue) : defaultValue;
  }
  return def;
}

module.exports = { jsonColumn, isSqlite };
