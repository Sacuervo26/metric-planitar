function requireApiKey(req, res, next) {
  const expected = process.env.API_KEY;
  if (!expected) return next();

  const provided = req.get("X-API-Key");
  if (provided && provided === expected) return next();

  return res.status(401).json({ error: "Unauthorized" });
}

module.exports = { requireApiKey };
