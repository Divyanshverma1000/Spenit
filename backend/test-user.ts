import pool from "./src/db/pool";
async function run() {
  const r = await pool.query('SELECT id, google_id FROM "User" LIMIT 1');
  console.log(r.rows);
  process.exit(0);
}
run();
