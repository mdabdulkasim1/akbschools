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
const SEED_JSON_FILE = path.join(ROOT, 'data', 'students.seed.json');
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

async function runSeeder() {
  writeLog('=== Starting Database Seeder ===');

  let db;
  try {
    if (MYSQL_URL) {
      db = await mysql.createConnection({ uri: MYSQL_URL, multipleStatements: true });
    } else {
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
    writeLog(`[ERROR] Seeder connection failed: ${err.message}`);
    process.exit(1);
  }

    const startTime = Date.now();
    try {
      const [countRows] = await db.query('SELECT COUNT(*) AS count FROM students');
      if (countRows && countRows[0] && countRows[0].count > 0) {
        writeLog(`Students table already populated (${countRows[0].count} records). Skipping seeding.`);
        await db.end();
        return;
      }
    } catch (e) {}

    // Read seed file
    let seedStudents = [];
    if (fs.existsSync(SEED_JSON_FILE)) {
      const parsedData = JSON.parse(fs.readFileSync(SEED_JSON_FILE, 'utf8'));
      seedStudents = Array.isArray(parsedData) ? parsedData : (parsedData.students || []);
      writeLog(`Loaded ${seedStudents.length} students from ${SEED_JSON_FILE}`);
    } else {
      writeLog(`[WARN] Seed file ${SEED_JSON_FILE} not found. Skipping student record seeding.`);
    }

    const crypto = require('crypto');
    function hashPass(password, saltHex) {
      return crypto.pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), 100000, 32, 'sha256').toString('hex');
    }

    const adminSalt = crypto.randomBytes(16).toString('hex');
    const acc1Salt = crypto.randomBytes(16).toString('hex');
    const acc2Salt = crypto.randomBytes(16).toString('hex');

    // Default state template
    const defaultState = {
      students: seedStudents,
      payments: [],
      users: [
        { username: 'admin', role: 'admin', name: 'System Administrator', salt: adminSalt, hash: hashPass('admin@123', adminSalt), mustChange: true },
        { username: 'account1', role: 'account', name: 'Accounts Manager 1', salt: acc1Salt, hash: hashPass('account1@123', acc1Salt), mustChange: true },
        { username: 'account2', role: 'account', name: 'Accounts Manager 2', salt: acc2Salt, hash: hashPass('account2@123', acc2Salt), mustChange: true }
      ],
      meta: {
        feeHeads: [
          { key: 'term1', label: 'Term 1 Fees', business: 'school' },
          { key: 'term2', label: 'Term 2 Fees', business: 'school' },
          { key: 'term3', label: 'Term 3 Fees', business: 'school' },
          { key: 'supplies', label: 'School Supplies', business: 'co' },
          { key: 'app_fees', label: 'App Fees Paid', business: 'school' },
          { key: 'uniform', label: 'Uniform & Accessories', business: 'co' },
          { key: 'transport', label: 'Transport Fees', business: 'falcon' },
          { key: 'extra_curricular', label: 'Extra Curricular Fees', business: 'school' },
          { key: 'evening_sports', label: 'Evening Sports', business: 'sports' },
          { key: 'event', label: 'Event Fees', business: 'school' }
        ]
      }
    };

    // 1. Seed relational table `students`
    if (seedStudents.length > 0) {
      for (const s of seedStudents) {
        await db.query(
          `INSERT INTO students (id, name, grade, class_teacher, gender, dob, age, prev_school, father, mother, contact, religion, location, drop_location, transport_type, vehicle, status, discount, admission, sports_activity, photo, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE name = VALUES(name), grade = VALUES(grade), class_teacher = VALUES(class_teacher), gender = VALUES(gender), father = VALUES(father), mother = VALUES(mother), contact = VALUES(contact), location = VALUES(location), vehicle = VALUES(vehicle), updated_at = NOW()`,
          [
            s.id || '', s.name || '', s.grade || '', s.classTeacher || '', s.gender || '', s.dob || '', s.age || '', s.prevSchool || '',
            s.father || '', s.mother || '', s.contact || '', s.religion || '', s.location || '', s.dropLocation || '', s.transportType || '',
            s.vehicle || '', s.status || 'active', s.discount || 0, s.admission || 'NEW', s.sportsActivity || '', s.photo || ''
          ]
        );
      }
      writeLog(`Seeded ${seedStudents.length} student records into \`students\` table.`);
    }

    // 3. Seed relational table `fee_heads`
    for (const h of defaultState.meta.feeHeads) {
      await db.query(
        `INSERT INTO fee_heads (head_key, label, business, created_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE label = VALUES(label), business = VALUES(business)`,
        [h.key, h.label, h.business]
      );
    }
    writeLog(`Seeded ${defaultState.meta.feeHeads.length} fee categories into \`fee_heads\` table.`);

    // 4. Seed relational table `student_fees`
    if (seedStudents.length > 0) {
      let feeCount = 0;
      for (const s of seedStudents) {
        if (!s.id || !s.fees) continue;
        for (let key of Object.keys(s.fees)) {
          const f = s.fees[key];
          if (!f) continue;
          if (key === 'term') key = 'term1';
          
          // Ensure head_key exists in fee_heads
          await db.query(
            `INSERT INTO fee_heads (head_key, label, business, created_at)
             VALUES (?, ?, 'school', NOW())
             ON DUPLICATE KEY UPDATE label = VALUES(label)`,
            [key, f.label || key]
          );

          const total = Number(f.total) || 0;
          const paid = Number(f.paid) || 0;
          const bal = Math.round((total - paid) * 100) / 100;
          await db.query(
            `INSERT INTO student_fees (student_id, head_key, total_amount, paid_amount, balance_amount, updated_at)
             VALUES (?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE total_amount = VALUES(total_amount), paid_amount = VALUES(paid_amount), balance_amount = VALUES(balance_amount), updated_at = NOW()`,
            [s.id, key, total, paid, bal]
          );
          feeCount++;
        }

        // Seed monthly transport breakdown
        if (s.transport && typeof s.transport === 'object') {
          for (const monthKey of Object.keys(s.transport)) {
            const tr = s.transport[monthKey];
            if (!tr) continue;
            const tTotal = Number(tr.total) || 0;
            const tPaid = Number(tr.paid) || 0;
            const tBal = Math.round((tTotal - tPaid) * 100) / 100;
            await db.query(
              `INSERT INTO student_transport_monthly (student_id, month_key, total_amount, paid_amount, balance_amount, updated_at)
               VALUES (?, ?, ?, ?, ?, NOW())
               ON DUPLICATE KEY UPDATE total_amount = VALUES(total_amount), paid_amount = VALUES(paid_amount), balance_amount = VALUES(balance_amount), updated_at = NOW()`,
              [s.id, monthKey, tTotal, tPaid, tBal]
            );
          }
        }

        // Seed sub-fees breakdown
        if (s.subs && typeof s.subs === 'object') {
          for (const parentHead of Object.keys(s.subs)) {
            const parentObj = s.subs[parentHead];
            if (!parentObj || typeof parentObj !== 'object') continue;
            for (const subKey of Object.keys(parentObj)) {
              const sub = parentObj[subKey];
              if (!sub) continue;
              const sTotal = Number(sub.total) || 0;
              const sPaid = Number(sub.paid) || 0;
              const sBal = Math.round((sTotal - sPaid) * 100) / 100;
              await db.query(
                `INSERT INTO student_sub_fees (student_id, parent_head_key, sub_key, total_amount, paid_amount, balance_amount, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE total_amount = VALUES(total_amount), paid_amount = VALUES(paid_amount), balance_amount = VALUES(balance_amount), updated_at = NOW()`,
                [s.id, parentHead, subKey, sTotal, sPaid, sBal]
              );
            }
          }
        }
      }
      writeLog(`Seeded ${feeCount} fee balances into \`student_fees\`, \`student_transport_monthly\`, and \`student_sub_fees\` tables.`);
    }

    // 5. Seed relational table `users`
    for (const u of defaultState.users) {
      const pwd = u.salt ? `${u.salt}:${u.hash}` : (u.hash || u.password || 'admin@123');
      await db.query(
        `INSERT INTO users (username, password_hash, role, name, created_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), name = VALUES(name)`,
        [u.username, pwd, u.role, u.name]
      );
    }
    writeLog(`Seeded default user accounts into \`users\` table.`);

    const duration = Date.now() - startTime;
    await db.query(
      `INSERT INTO migration_logs (name, status, execution_time_ms, message, executed_at) VALUES ('seeder.js', 'SUCCESS', ?, ?, NOW())`,
      [duration, `Successfully seeded database with ${seedStudents.length} students in ${duration}ms`]
    );

    writeLog(`=== Seeder Finished Successfully in ${duration}ms ===`);
    await db.end();
  } catch (err) {
    const duration = Date.now() - startTime;
    try {
      await db.query(
        `INSERT INTO migration_logs (name, status, execution_time_ms, message, executed_at) VALUES ('seeder.js', 'FAILED', ?, ?, NOW())`,
        [duration, err.message]
      );
    } catch (e) {}
    writeLog(`[FAILED] Seeder failed: ${err.message}`);
    if (db) await db.end();
    process.exit(1);
  }
}

if (require.main === module) {
  runSeeder();
} else {
  module.exports = { runSeeder };
}
