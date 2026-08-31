'use strict';

const { runMigrations } = require('./migrate');
const { runSeeder } = require('./seed');

async function setupDatabase() {
  console.log('--- Starting Database Setup (Migrations & Seeder) ---');
  try {
    await runMigrations();
    await runSeeder();
    console.log('--- Database Setup Completed Successfully ---');
  } catch (err) {
    console.error('--- Database Setup Failed ---', err.message);
    if (require.main === module) process.exit(1);
    throw err;
  }
}

if (require.main === module) {
  setupDatabase();
} else {
  module.exports = { setupDatabase };
}
