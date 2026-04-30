const express = require("express");
const bcrypt = require("bcryptjs");
const { User } = require("../models");
const { signToken, requireAuth } = require("../middleware/jwtAuth");

const router = express.Router();

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;
const MIN_PASSWORD_LENGTH = 8;

function isValidPassword(pwd) {
  if (typeof pwd !== "string") return false;
  if (pwd.length < MIN_PASSWORD_LENGTH) return false;
  // At least one letter and one digit
  if (!/[A-Za-z]/.test(pwd)) return false;
  if (!/[0-9]/.test(pwd)) return false;
  return true;
}

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "email y password son requeridos" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ where: { email: normalizedEmail } });

    // Constant-ish error message to avoid leaking which field was wrong.
    if (!user) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos" });
    }

    await user.update({ lastLoginAt: new Date(), lastActiveAt: new Date() });

    const token = signToken(user);
    return res.json({
      token,
      user: user.toPublicJSON(),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    return res.json({ user: req.user.toPublicJSON() });
  } catch (err) {
    next(err);
  }
});

router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string"
    ) {
      return res
        .status(400)
        .json({ error: "currentPassword y newPassword son requeridos" });
    }

    const ok = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Contraseña actual incorrecta" });
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({
        error:
          "La nueva contraseña debe tener al menos 8 caracteres, una letra y un número.",
      });
    }

    if (newPassword === currentPassword) {
      return res
        .status(400)
        .json({ error: "La nueva contraseña debe ser distinta de la actual" });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await req.user.update({
      passwordHash: newHash,
      mustChangePassword: false,
    });

    return res.json({ ok: true, user: req.user.toPublicJSON() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
