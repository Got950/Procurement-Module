import "dotenv/config";

/**
 * Integration tests run against a real PostgreSQL database, because the raw-SQL
 * layer and its transactions cannot be meaningfully mocked. The target is
 * TEST_DATABASE_URL, or DATABASE_URL with `_test` appended to the database name.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return assertTestDatabase(explicit);
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("Set TEST_DATABASE_URL or DATABASE_URL to run tests");
  const url = new URL(base);
  url.pathname = `/${url.pathname.replace(/^\//, "")}_test`;
  return assertTestDatabase(url.toString());
}

/** Tests truncate every table, so refuse anything not named as a test database. */
function assertTestDatabase(url: string): string {
  const database = new URL(url).pathname.replace(/^\//, "");
  if (!database.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${database}": name must end with _test`);
  }
  return url;
}

/** Point the application's pool at the test database before src/lib/db is used. */
export function useTestDatabase() {
  process.env.DATABASE_URL = testDatabaseUrl();
}
