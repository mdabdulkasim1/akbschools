const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function loadEnv() {
  try { require('dotenv').config(); } catch (e) {}
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx > 0) {
          const key = trimmed.slice(0, idx).trim();
          let val = trimmed.slice(idx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) process.env[key] = val;
        }
      }
    }
  } catch (e) {}
}
loadEnv();

const MYSQL_URL = process.env.MYSQL_URL || process.env.DATABASE_URL || '';
const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD !== undefined ? process.env.MYSQL_PASSWORD : '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'akb-school-mk';
const MYSQL_PORT = parseInt(process.env.MYSQL_PORT, 10) || 3306;

const ROOT = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'migration.log');

function writeLog(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  console.log(message);
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, logLine, 'utf8');
  } catch (err) {
    console.error('Failed to write to log file:', err.message);
  }
}

function parseVersion(filename) {
  // Matches patterns like v1.0.0__name.sql, V1.0_name.sql, 001_v1.0.0_name.sql, etc.
  const match = filename.match(/v?(\d+\.\d+(?:\.\d+)?)/i) || filename.match(/^(\d+)/);
  return match ? match[1] : '0.0.0';
}

async function runMigrations() {
  writeLog('=== Starting Versioned Database Migration Runner ===');
  if (MYSQL_URL) {
    writeLog(`Target DB: connecting via MYSQL_URL / DATABASE_URL`);
  } else {
    writeLog(`Target DB: ${MYSQL_DATABASE} @ ${MYSQL_HOST}:${MYSQL_PORT}`);
  }

  // Connect to target database
  let db;
  try {
    if (MYSQL_URL) {
      db = await mysql.createConnection({ uri: MYSQL_URL, multipleStatements: true });
    } else {
      // Connect without database first to ensure database exists
      let sysConn;
      try {
        sysConn = await mysql.createConnection({
          host: MYSQL_HOST,
          user: MYSQL_USER,
          password: MYSQL_PASSWORD,
          port: MYSQL_PORT
        });
        await sysConn.query(`CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` DEFAULT CHARACTER SET utf8mb4;`);
        await sysConn.end();
        writeLog(`Database '${MYSQL_DATABASE}' verified/created.`);
      } catch (err) {
        writeLog(`[WARN] Failed sysConn database check: ${err.message}`);
      }

      db = await mysql.createConnection({
        host: MYSQL_HOST,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: MYSQL_DATABASE,
        port: MYSQL_PORT,
        multipleStatements: true
      });
    }
  } catch (err) {
    writeLog(`[ERROR] Database connection failed: ${err.message}`);
    process.exit(1);
  }

  try {
    // Ensure migration_logs table exists with version column
    await db.query(`
      CREATE TABLE IF NOT EXISTS migration_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        version VARCHAR(50) DEFAULT NULL,
        name VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        execution_time_ms INT DEFAULT 0,
        message TEXT,
        executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure version column exists if table was previously created without it
    const [cols] = await db.query(`SHOW COLUMNS FROM migration_logs LIKE 'version'`);
    if (cols.length === 0) {
      await db.query(`ALTER TABLE migration_logs ADD COLUMN version VARCHAR(50) DEFAULT NULL AFTER id`);
    }

    // Get executed migrations
    const [rows] = await db.query(`SELECT name, version FROM migration_logs WHERE status = 'SUCCESS'`);
    const executedMigrations = new Set(rows.map(r => r.name));

    // Get current version
    const [latestVerRow] = await db.query(`SELECT version FROM migration_logs WHERE status = 'SUCCESS' AND version IS NOT NULL ORDER BY id DESC LIMIT 1`);
    const currentVer = latestVerRow.length > 0 ? latestVerRow[0].version : '0.0.0';
    writeLog(`Current DB Schema Version: v${currentVer}`);

    // Read migration SQL files
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      writeLog(`Migrations directory '${MIGRATIONS_DIR}' not found.`);
      await db.end();
      return;
    }

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    if (files.length === 0) {
      writeLog('No SQL migration files found.');
      await db.end();
      return;
    }

    let appliedCount = 0;
    for (const file of files) {
      const ver = parseVersion(file);
      if (executedMigrations.has(file)) {
        writeLog(`[SKIP] Migration '${file}' (v${ver}) already executed.`);
        continue;
      }

      writeLog(`[RUNNING] Executing migration: ${file} (Target Version: v${ver})`);
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      const startTime = Date.now();

      try {
        await db.query(sql);
        const duration = Date.now() - startTime;
        await db.query(
          `INSERT INTO migration_logs (version, name, status, execution_time_ms, message, executed_at) VALUES (?, ?, 'SUCCESS', ?, ?, NOW())`,
          [ver, file, duration, `Successfully applied in ${duration}ms`]
        );
        writeLog(`[SUCCESS] Applied migration '${file}' (v${ver}) in ${duration}ms.`);
        appliedCount++;
      } catch (err) {
        const duration = Date.now() - startTime;
        await db.query(
          `INSERT INTO migration_logs (version, name, status, execution_time_ms, message, executed_at) VALUES (?, ?, 'FAILED', ?, ?, NOW())`,
          [ver, file, duration, err.message]
        );
        writeLog(`[FAILED] Migration '${file}' (v${ver}) failed: ${err.message}`);
        await db.end();
        process.exit(1);
      }
    }

    // Final version after migrations
    const [finalVerRow] = await db.query(`SELECT version FROM migration_logs WHERE status = 'SUCCESS' AND version IS NOT NULL ORDER BY id DESC LIMIT 1`);
    const finalVer = finalVerRow.length > 0 ? finalVerRow[0].version : currentVer;

    writeLog(`=== Migration Runner Finished. DB now at v${finalVer} (${appliedCount} new migrations applied). ===`);
    await db.end();
  } catch (err) {
    writeLog(`[ERROR] Migration failed: ${err.message}`);
    if (db) await db.end();
    process.exit(1);
  }
}

if (require.main === module) {
  runMigrations();
} else {
  module.exports = { runMigrations };
}
