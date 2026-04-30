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
const { requireApiKey } = require("../middleware/auth");
const { requireLeader } = require("../middleware/jwtAuth");

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
router.post("/bootstrap-users", requireApiKey, async (_req, res, next) => {
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

/* ─────────────────────────────────────────────────────────────────────
 *  /admin/users — leader-only user management
 *  Protected by requireLeader (JWT), so only authenticated leaders can
 *  list, create, edit, delete or reset passwords for other accounts.
 * ───────────────────────────────────────────────────────────────────── */

const VALID_ROLES = ["leader", "member"];

function userToPublic(user) {
  return user.toPublicJSON();
}

router.get("/users", requireLeader, async (_req, res, next) => {
  try {
    const users = await User.findAll({
      order: [
        ["role", "ASC"],
        ["team", "ASC"],
        ["displayName", "ASC"],
      ],
    });
    return res.json({ users: users.map(userToPublic) });
  } catch (err) {
    next(err);
  }
});

router.post("/users", requireLeader, async (req, res, next) => {
  try {
    const {
      email,
      displayName,
      normalizedPersonName,
      team,
      role,
    } = req.body || {};

    if (typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "Email inválido" });
    }
    if (typeof displayName !== "string" || !displayName.trim()) {
      return res.status(400).json({ error: "displayName es requerido" });
    }
    if (!VALID_ROLES.includes(role)) {
      return res
        .status(400)
        .json({ error: `role debe ser uno de: ${VALID_ROLES.join(", ")}` });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ where: { email: cleanEmail } });
    if (existing) {
      return res
        .status(409)
        .json({ error: "Ya existe una cuenta con ese correo." });
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    const created = await User.create({
      email: cleanEmail,
      displayName: displayName.trim(),
      normalizedPersonName:
        typeof normalizedPersonName === "string" && normalizedPersonName.trim()
          ? normalizedPersonName.trim().toLowerCase()
          : normalizeName(displayName),
      team: team || null,
      role,
      passwordHash,
      mustChangePassword: true,
    });

    return res.status(201).json({
      user: userToPublic(created),
      tempPassword,
      note:
        "Pásale esta contraseña a la persona. No se puede recuperar después; si la pierde, hay que resetearla.",
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/users/:id", requireLeader, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "id inválido" });
    }
    const target = await User.findByPk(id);
    if (!target) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const { email, displayName, normalizedPersonName, team, role } =
      req.body || {};
    const patch = {};

    if (typeof email === "string") {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail.includes("@")) {
        return res.status(400).json({ error: "Email inválido" });
      }
      if (cleanEmail !== target.email) {
        const collision = await User.findOne({
          where: { email: cleanEmail },
        });
        if (collision && collision.id !== target.id) {
          return res
            .status(409)
            .json({ error: "Ya hay otra cuenta con ese correo." });
        }
        patch.email = cleanEmail;
      }
    }

    if (typeof displayName === "string" && displayName.trim()) {
      patch.displayName = displayName.trim();
    }
    if (typeof normalizedPersonName === "string") {
      patch.normalizedPersonName = normalizedPersonName.trim().toLowerCase();
    }
    if (team === null || typeof team === "string") {
      patch.team = team || null;
    }
    if (typeof role === "string") {
      if (!VALID_ROLES.includes(role)) {
        return res
          .status(400)
          .json({ error: `role debe ser uno de: ${VALID_ROLES.join(", ")}` });
      }
      // Don't let a leader demote themselves and lock everyone out.
      if (
        role === "member" &&
        target.id === req.user.id &&
        target.role === "leader"
      ) {
        return res.status(400).json({
          error:
            "No puedes degradarte a ti mismo. Pídele a otro líder que lo haga.",
        });
      }
      patch.role = role;
    }

    if (Object.keys(patch).length === 0) {
      return res.json({ user: userToPublic(target), changed: false });
    }

    await target.update(patch);
    return res.json({ user: userToPublic(target), changed: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/users/:id", requireLeader, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "id inválido" });
    }
    const target = await User.findByPk(id);
    if (!target) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    if (target.id === req.user.id) {
      return res
        .status(400)
        .json({ error: "No puedes eliminar tu propia cuenta." });
    }
    await target.destroy();
    return res.json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/users/:id/reset-password",
  requireLeader,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "id inválido" });
      }
      const target = await User.findByPk(id);
      if (!target) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
      await target.update({
        passwordHash,
        mustChangePassword: true,
      });

      return res.json({
        ok: true,
        user: userToPublic(target),
        tempPassword,
        note:
          "Pásale esta contraseña a la persona AHORA. No se puede recuperar después.",
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
