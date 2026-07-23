import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Shared pg Pool singleton — import this everywhere instead of creating new Pool() instances.
// Connection config is read from DATABASE_URL in .env.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error:", err.message);
});

export default pool;
