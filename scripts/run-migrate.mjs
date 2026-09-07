/**
 * Programmatic migrate runner for Docker/EC2 deploys.
 * Prefer this over `npx node-pg-migrate up` so migrations that set
 * `exports.disableTransaction = true` (CREATE INDEX CONCURRENTLY) work.
 */
import migrate from "node-pg-migrate";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

await migrate({
  databaseUrl,
  dir: "migrations",
  direction: "up",
  migrationsTable: "pgmigrations",
  count: Infinity,
  log: console.log,
});
console.log("Migrations complete");
