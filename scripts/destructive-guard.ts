/**
 * Gate for scripts that truncate tables. Both guards must pass: an explicit
 * opt-in, and a target that looks like a development database. Without this a
 * stray `npm run db:seed` against a production DATABASE_URL erases everything.
 */
export function assertDestructiveAllowed(action: string) {
  if (process.env.ALLOW_DESTRUCTIVE !== "1") {
    throw new Error(
      `${action} destroys data. Re-run with ALLOW_DESTRUCTIVE=1 if that is intended.`
    );
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${action} refused: NODE_ENV=production.`);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, "");
  const isLocalHost = ["localhost", "127.0.0.1", "::1", "db"].includes(parsed.hostname);
  const looksDevelopment = /(^|[-_])(dev|test|local)([-_]|$)/i.test(database);
  if (!isLocalHost && !looksDevelopment) {
    throw new Error(
      `${action} refused: ${parsed.hostname}/${database} is neither a local host nor a database named for dev/test/local.`
    );
  }
}
