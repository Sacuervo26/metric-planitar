/**
 * One-shot admin endpoints used to bootstrap the database when the host
 * doesn't allow running CLI commands (e.g. Render free tier has no shell).
 *
 * Protected by the same X-API-Key as /cloud-state. After the initial
 * bootstrap, leaders should manage users through the in-app /users page
 * (built in a follow-up phase) — this endpoint stays available for
 * adding any new people whose normalized name needs to be precomputed.
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { sequelize, User } = require("../models");

const router = express.Router();

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;

const LEADERS = [
  { email: "dcespejoguzman@planitar.com", displayName: "Daniel Camilo Espejo", normalizedPersonName: "daniel camilo espejo", team: null },
  { email: "mvasquez@planitar.com", displayName: "Maria Vasquez", normalizedPersonName: "maria vasquez", team: null },
  { email: "drodriguez@planitar.com", displayName: "David Rodriguez", normalizedPersonName: "david rodriguez", team: null },
  { email: "scuervo@planitar.com", displayName: "Sebastian Cuervo", normalizedPersonName: "sebastian cuervo", team: null },
];

const RRECO1 = [
  { email: "dsuarez@planitar.com", displayName: "Danna Suarez" },
  { email: "lgomez@planitar.com", displayName: "Laura Gomez" },
  { email: "ppinto@planitar.com", displayName: "Paula Pinto" },
  { email: "tjimenez@planitar.com", displayName: "Tatiana Jimenez" },
  { email: "vdiago@planitar.com", displayName: "Valeria Diago" },
  { email: "tvalencia@planitar.com", displayName: "Tatiana Valencia" },
  { email: "mquintero@planitar.com", displayName: "Maria Quintero" },
  { email: "jalfonso@planitar.com", displayName: "Juan Alfonso" },
  { email: "sbuitrago@planitar.com", displayName: "Santiago Buitrago" },
  { email: "sgomez@planitar.com", displayName: "Sofia Gomez" },
  { email: "svargas@planitar.com", displayName: "Shelsy Vargas" },
  { email: "jjrengifo@planitar.com", displayName: "Juan Jose Rengifo" },
  { email: "nlopez@planitar.com", displayName: "Nathalia Lopez" },
  { email: "lbocanegra@planitar.com", displayName: "Lina Bocanegra" },
];

const RRECO2 = [
  { email: "gramirez@planitar.com", displayName: "Gisell Ramirez" },
  { email: "ggomez@planitar.com", displayName: "Gabriela Gomez" },
  { email: "lvanegas@planitar.com", displayName: "Laura Vanegas" },
  { email: "aaguirre@planitar.com", displayName: "Andres Aguirre" },
  { email: "lpena@planitar.com", displayName: "Laura Pena" },
  { email: "agaravito@planitar.com", displayName: "Andres Garavito" },
  { email: "jrodriguez@planitar.com", displayName: "Julian Rodriguez" },
  { email: "lvacca@planitar.com", displayName: "Laura Vacca" },
  { email: "sespinosa@planitar.com", displayName: "Sergio Espinosa" },
  { email: "jrivera@planitar.com", displayName: "Juan Rivera" },
  { email: "jddrivera@planitar.com", displayName: "Juan David Rivera" },
  { email: "srodriguez@planitar.com", displayName: "Saray Rodriguez" },
  { email: "kruiz@planitar.com", displayName: "Karol Ruiz" },
  { email: "jgiraldo@planitar.com", displayName: "Juan David Giraldo" },
];

const RRECO3 = [
  { email: "ibcamargo@planitar.com", displayName: "Isabella Bernal Camargo" },
  { email: "jgarces@planitar.com", displayName: "Juan Garces" },
  { email: "mpena@planitar.com", displayName: "Mateo Pena" },
  { email: "mfbello@planitar.com", displayName: "Maria Fernanda Bello" },
  { email: "jramirez@planitar.com", displayName: "Josue Ramirez" },
  { email: "jclaros@planitar.com", displayName: "Jessy Claros" },
  { email: "oespitia@planitar.com", displayName: "Orlando Espitia" },
  { email: "mramirez@planitar.com", displayName: "Mauricio Ramirez" },
  { email: "mcorrea@planitar.com", displayName: "Maria Jose Correa" },
  { email: "arico@planitar.com", displayName: "Andrea Rico" },
];

function normalizeName(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildSeed() {
  const seed = [];
  for (const l of LEADERS) {
    seed.push({
      email: l.email,
      displayName: l.displayName,
      normalizedPersonName: l.normalizedPersonName,
      team: l.team,
      role: "leader",
    });
  }
  for (const m of RRECO1) {
    seed.push({
      email: m.email,
      displayName: m.displayName,
      normalizedPersonName: normalizeName(m.displayName),
      team: "RRECO1",
      role: "member",
    });
  }
  for (const m of RRECO2) {
    seed.push({
      email: m.email,
      displayName: m.displayName,
      normalizedPersonName: normalizeName(m.displayName),
      team: "RRECO2",
      role: "member",
    });
  }
  for (const m of RRECO3) {
    seed.push({
      email: m.email,
      displayName: m.displayName,
      normalizedPersonName: normalizeName(m.displayName),
      team: "RRECO3",
      role: "member",
    });
  }
  return seed;
}

function generateTempPassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let pwd = "";
  for (let i = 0; i < 12; i++) {
    pwd += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return pwd;
}

/**
 * POST /admin/bootstrap-users
 *
 * Idempotent. Ensures the `users` table exists and creates any roster
 * member who isn't yet in the table, returning their one-time temp
 * passwords. Re-running it after everyone exists returns an empty
 * `created` list.
 */
router.post("/bootstrap-users", async (_req, res, next) => {
  try {
    // 1) Ensure the table exists (no-op if migrations already created it).
    await User.sync();

    // 2) Best-effort: mark the migration as applied so a future
    //    `npm run db:migrate` doesn't try to re-create the table.
    try {
      const dialect = sequelize.getDialect();
      const sql =
        dialect === "postgres"
          ? `INSERT INTO "SequelizeMeta" (name) VALUES (:name) ON CONFLICT DO NOTHING`
          : `INSERT OR IGNORE INTO SequelizeMeta (name) VALUES (:name)`;
      await sequelize.query(sql, {
        replacements: { name: "20260430000000-create-users.js" },
      });
    } catch {
      // SequelizeMeta might not exist (first install ever). It will be
      // created when the migrations table is initialized. Not blocking.
    }

    // 3) Create any missing accounts.
    const seed = buildSeed();
    const created = [];
    let skipped = 0;

    for (const entry of seed) {
      const existing = await User.findOne({ where: { email: entry.email } });
      if (existing) {
        skipped += 1;
        continue;
      }
      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
      await User.create({
        ...entry,
        passwordHash,
        mustChangePassword: true,
      });
      created.push({
        email: entry.email,
        displayName: entry.displayName,
        team: entry.team,
        role: entry.role,
        tempPassword,
      });
    }

    return res.json({
      ok: true,
      createdCount: created.length,
      skippedCount: skipped,
      passwords: created,
      note:
        created.length > 0
          ? "Copia estas contraseñas AHORA. No se pueden recuperar después."
          : "Todos los usuarios ya existen. No se generaron contraseñas nuevas.",
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
