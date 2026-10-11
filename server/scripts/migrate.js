require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to apply database migrations.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  const migrationPath = path.join(__dirname, "../migrations/001_initial_schema.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Applied 001_initial_schema.sql");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error("Database migration failed:", error.message);
  process.exitCode = 1;
});
