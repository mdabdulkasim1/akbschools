"use strict";
/**
 * Seed initial schools + accounts if the database is empty.
 * Default passwords are intentionally simple and MUST be changed after first
 * login (each user can change their own; the Chairman can reset any principal).
 */
const db = require("./db");
const { hashPassword } = require("./auth");

const DEFAULTS = {
  admin: { username: "chairman", password: "Chairman@123", name: "Chairman" },
  schools: [
    {
      name: "AKB School of Excellence",
      place: "Cheranmahadevi",
      principal: { username: "principal.akb", password: "Principal@123", name: "Principal — AKB School" },
    },
    {
      name: "Second School (rename me)",
      place: "—",
      principal: { username: "principal.school2", password: "Principal@123", name: "Principal — Second School" },
    },
  ],
};

function seedIfEmpty() {
  const data = db.load();
  if (data.users.length > 0) return { seeded: false };

  // Admin / Chairman
  data.users.push({
    id: db.id(),
    username: DEFAULTS.admin.username,
    name: DEFAULTS.admin.name,
    role: "admin",
    schoolId: null,
    passHash: hashPassword(DEFAULTS.admin.password),
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
  });

  DEFAULTS.schools.forEach((s) => {
    const schoolId = db.id();
    data.schools.push({ id: schoolId, name: s.name, place: s.place });
    data.users.push({
      id: db.id(),
      username: s.principal.username,
      name: s.principal.name,
      role: "principal",
      schoolId,
      passHash: hashPassword(s.principal.password),
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
    });
  });

  db.save();
  return { seeded: true, defaults: DEFAULTS };
}

module.exports = { seedIfEmpty, DEFAULTS };
