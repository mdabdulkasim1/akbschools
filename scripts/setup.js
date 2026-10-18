'use strict';

const { runMigrations } = require('./migrate');

async function setupDatabase() {
  console.log('--- Starting Database Setup (Migrations Only) ---');
  try {
    await runMigrations();
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
