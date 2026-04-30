const jwt = require("jsonwebtoken");
const { User } = require("../models");

const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";

if (!JWT_SECRET) {
  console.warn(
    "[backend] WARNING: JWT_SECRET not set — auth tokens will be rejected. Set JWT_SECRET in .env."
  );
}

function signToken(user) {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured on the server");
  }
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function readTokenFromRequest(req) {
  const header = req.get("Authorization") || "";
  if (header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  // Fall-back: allow ?token= for non-XHR contexts (printable reports, etc.).
  if (typeof req.query?.token === "string" && req.query.token.length > 0) {
    return req.query.token;
  }
  return null;
}

async function loadUserFromToken(req) {
  if (!JWT_SECRET) return null;

  const token = readTokenFromRequest(req);
  if (!token) return null;

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }

  const user = await User.findByPk(payload.sub);
  if (!user) return null;

  // Touch last_active_at lazily — best-effort, never block the request.
  user
    .update({ lastActiveAt: new Date() }, { silent: true })
    .catch(() => {});

  return user;
}

async function requireAuth(req, res, next) {
  try {
    const user = await loadUserFromToken(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

async function requireLeader(req, res, next) {
  try {
    const user = await loadUserFromToken(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (user.role !== "leader") {
      return res.status(403).json({ error: "Forbidden — leader role required" });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  signToken,
  readTokenFromRequest,
  loadUserFromToken,
  requireAuth,
  requireLeader,
};
