import migrate from "node-pg-migrate";
import { Client } from "pg";
import { testDatabaseUrl } from "./test-db";

/**
 * Creates the test database if absent and brings it to the latest migration
 * with the same runner the deploy uses. If PostgreSQL is unreachable locally the
 * integration suites skip; in CI that is a hard failure.
 */
export default async function setup() {
  let url: string;
  try {
    url = testDatabaseUrl();
  } catch (error) {
    return unavailable(error as Error);
  }

  const target = new URL(url);
  const database = target.pathname.replace(/^\//, "");
  const admin = new URL(url);
  admin.pathname = "/postgres";

  const client = new Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch (error) {
    return unavailable(error as Error);
  }
  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (existing.rowCount === 0) {
      // Identifier cannot be parameterised; the name is validated to end with _test.
      await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }

  await migrate({
    databaseUrl: url,
    dir: "migrations",
    direction: "up",
    migrationsTable: "pgmigrations",
    count: Infinity,
    log: () => {},
  });
}

function unavailable(error: Error) {
  if (process.env.CI) throw error;
  process.env.TEST_DB_UNAVAILABLE = "1";
  console.warn(`Skipping integration tests: ${error.message}`);
}
