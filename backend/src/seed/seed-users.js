/**
 * One-time seed for the `users` table.
 *
 * Usage (locally or on Render shell):
 *   node src/seed/seed-users.js
 *
 * Behavior:
 *  - Creates any user whose email is not yet in the table.
 *  - Skips existing users (so re-running is safe).
 *  - Generates a random temporary password for each newly-created user
 *    and prints it ONCE to stdout. mustChangePassword=true forces them
 *    to set a real password on first login.
 *  - Does NOT touch existing users' passwords or roles. To reset a single
 *    password, use the admin /admin/users/:id/reset-password endpoint
 *    (built in Phase 1 admin UI).
 */

require("dotenv").config();

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { sequelize, User } = require("../models");

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;

const LEADERS = [
  {
    email: "dcespejoguzman@planitar.com",
    displayName: "Daniel Camilo Espejo",
    normalizedPersonName: "daniel camilo espejo",
    team: null,
  },
  {
    email: "mvasquez@planitar.com",
    displayName: "Maria Vasquez",
    normalizedPersonName: "maria vasquez",
    team: null,
  },
  {
    email: "drodriguez@planitar.com",
    displayName: "David Rodriguez",
    normalizedPersonName: "david rodriguez",
    team: null,
  },
  {
    email: "scuervo@planitar.com",
    displayName: "Sebastian Cuervo",
    normalizedPersonName: "sebastian cuervo",
    team: null,
  },
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
  // 12 chars, alphanum, guaranteed at least one digit + one letter.
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let pwd = "";
  for (let i = 0; i < 12; i++) {
    pwd += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return pwd;
}

async function main() {
  console.log("[seed] Connecting to database…");
  await sequelize.authenticate();
  console.log("[seed] Connected. Running user seed.");

  const seed = buildSeed();
  const created = [];
  const skipped = [];

  for (const entry of seed) {
    const existing = await User.findOne({ where: { email: entry.email } });
    if (existing) {
      skipped.push(entry.email);
      continue;
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    await User.create({
      ...entry,
      passwordHash,
      mustChangePassword: true,
    });
    created.push({ ...entry, tempPassword });
  }

  console.log("\n========== SEED RESULT ==========");
  console.log(`Created: ${created.length}`);
  console.log(`Skipped (already existed): ${skipped.length}`);
  console.log("=================================\n");

  if (created.length > 0) {
    console.log(
      "Temporary passwords (copy these BEFORE you close this terminal):\n"
    );
    console.log("Email".padEnd(38), "Role".padEnd(8), "Team".padEnd(8), "Temp Password");
    console.log("-".repeat(80));
    for (const u of created) {
      console.log(
        u.email.padEnd(38),
        u.role.padEnd(8),
        (u.team || "-").padEnd(8),
        u.tempPassword
      );
    }
    console.log(
      "\nEach user must change their password on first login (mustChangePassword=true)."
    );
  }

  await sequelize.close();
  console.log("[seed] Done.");
}

main().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
