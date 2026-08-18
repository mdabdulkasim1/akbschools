"use strict";
/**
 * Password hashing (scrypt) + cookie session management. Zero dependencies.
 */
const crypto = require("crypto");

/* ---------- Passwords ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(derived, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- Sessions (in-memory, TTL) ---------- */
const SESSIONS = new Map(); // token -> { userId, expires }
const COOKIE = "par_session";
const TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  SESSIONS.set(token, { userId, expires: Date.now() + TTL_MS });
  return token;
}

function destroySession(token) {
  if (token) SESSIONS.delete(token);
}

function getSession(token) {
  if (!token) return null;
  const s = SESSIONS.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) {
    SESSIONS.delete(token);
    return null;
  }
  // sliding expiry
  s.expires = Date.now() + TTL_MS;
  return s;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx > -1) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token) {
  const attrs = [
    `${COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
  ];
  if (process.env.SECURE_COOKIE === "1") attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function tokenFromReq(req) {
  return parseCookies(req)[COOKIE] || null;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getSession,
  setSessionCookie,
  clearSessionCookie,
  tokenFromReq,
  COOKIE,
};
