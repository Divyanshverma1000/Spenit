/**
 * Migration runner for Spenit.
 *
 * Strategy:
 *  - Maintains a `_migrations` table to track which .sql files have been applied.
 *  - Reads all .sql files from /migrations in filename order.
 *  - Skips already-applied files; runs new ones inside a transaction.
 *  - Exits 0 on success, 1 on failure.
 *
 * Usage:  npx ts-node src/db/migrate.ts
 */

import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function runMigrations() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // Ensure migrations tracking table exists
    await client.query(`
      create table if not exists _migrations (
        id         serial primary key,
        filename   text unique not null,
        applied_at timestamptz not null default now()
      )
    `);

    const migrationsDir = path.resolve(__dirname, "../../migrations");
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort(); // lexicographic order: 001_..., 002_..., etc.

    for (const filename of files) {
      const { rows } = await client.query(
        "select 1 from _migrations where filename = $1",
        [filename]
      );

      if (rows.length > 0) {
        console.log(`  skip  ${filename}  (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf8");

      console.log(`  apply ${filename} …`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into _migrations (filename) values ($1)",
          [filename]
        );
        await client.query("commit");
        console.log(`  ✓     ${filename}`);
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }

    console.log("\n✅  All migrations applied successfully.\n");
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error("\n❌  Migration failed:", err.message);
  process.exit(1);
});
