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
    process.exit(1);
  }
}

if (require.main === module) {
  setupDatabase();
} else {
  module.exports = { setupDatabase };
}
