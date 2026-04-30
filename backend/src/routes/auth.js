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

// Profile editing: any authenticated user can update their OWN bio
// and avatar. Leader-managed editing of another user's profile lives
// under /admin/users/:id (separate concern).
const MAX_BIO_LENGTH = 1500;
const MAX_PHOTO_DATA_URL_LENGTH = 800_000; // ~600KB worth of base64
const MAX_COVER_DATA_URL_LENGTH = 1_500_000; // ~1.1MB worth of base64

const DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/;

router.patch("/me/profile", requireAuth, async (req, res, next) => {
  try {
    const { bio, photoDataUrl, coverDataUrl } = req.body || {};
    const patch = {};

    if (typeof bio === "string") {
      if (bio.length > MAX_BIO_LENGTH) {
        return res.status(400).json({
          error: `La descripción excede ${MAX_BIO_LENGTH} caracteres.`,
        });
      }
      patch.bio = bio.trim() || null;
    } else if (bio === null) {
      patch.bio = null;
    }

    if (typeof photoDataUrl === "string") {
      if (photoDataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
        return res.status(400).json({
          error:
            "La foto es demasiado grande. Sube una imagen más pequeña (máx ~500 KB).",
        });
      }
      if (photoDataUrl.length > 0 && !DATA_URL_PATTERN.test(photoDataUrl)) {
        return res.status(400).json({
          error: "La imagen debe estar codificada como data URL base64.",
        });
      }
      patch.photoDataUrl = photoDataUrl || null;
    } else if (photoDataUrl === null) {
      patch.photoDataUrl = null;
    }

    if (typeof coverDataUrl === "string") {
      if (coverDataUrl.length > MAX_COVER_DATA_URL_LENGTH) {
        return res.status(400).json({
          error:
            "La portada es demasiado grande. Sube una imagen más pequeña (máx ~1 MB).",
        });
      }
      if (coverDataUrl.length > 0 && !DATA_URL_PATTERN.test(coverDataUrl)) {
        return res.status(400).json({
          error: "La portada debe estar codificada como data URL base64.",
        });
      }
      patch.coverDataUrl = coverDataUrl || null;
    } else if (coverDataUrl === null) {
      patch.coverDataUrl = null;
    }

    if (Object.keys(patch).length === 0) {
      return res.json({ user: req.user.toPublicJSON(), changed: false });
    }

    await req.user.update(patch);
    return res.json({ user: req.user.toPublicJSON(), changed: true });
  } catch (err) {
    next(err);
  }
});

router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof newPassword !== "string") {
      return res.status(400).json({ error: "newPassword es requerido" });
    }

    // First-login shortcut: the user is already JWT-authenticated (they just
    // proved knowledge of their temp password by logging in), so don't make
    // them type it a second time. We only verify the current password when
    // they're rotating an already-real password.
    const isFirstLogin = Boolean(req.user.mustChangePassword);
    if (!isFirstLogin) {
      if (typeof currentPassword !== "string") {
        return res
          .status(400)
          .json({ error: "currentPassword es requerido" });
      }
      const ok = await bcrypt.compare(currentPassword, req.user.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: "Contraseña actual incorrecta" });
      }
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({
        error:
          "La nueva contraseña debe tener al menos 8 caracteres, una letra y un número.",
      });
    }

    // Defensive: don't let someone "rotate" to the exact same hash they
    // already have. Cheap to check and useful both for first-login (avoids
    // keeping the temp password as the permanent one) and for rotations.
    const matchesExisting = await bcrypt.compare(
      newPassword,
      req.user.passwordHash
    );
    if (matchesExisting) {
      return res.status(400).json({
        error: isFirstLogin
          ? "La nueva contraseña no puede ser la temporal."
          : "La nueva contraseña debe ser distinta de la actual.",
      });
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
