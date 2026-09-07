/**
 * Ensures the seven roles and one ADMIN user exist.
 * The password comes from ADMIN_INITIAL_PASSWORD; there is no default, because a
 * default admin credential in the repository is a known-credential path to ADMIN.
 */
import "dotenv/config";
import { query } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

const EMAIL = process.env.ADMIN_EMAIL ?? "admin@must.co.in";
const USERNAME = process.env.ADMIN_USERNAME ?? "admin";

async function main() {
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error(
      "ADMIN_INITIAL_PASSWORD must be set to at least 12 characters (it is not stored in the repository)"
    );
  }

  await query(`
    INSERT INTO roles (code, label) VALUES
      ('REQUESTER', 'Requester'),
      ('TEAM_LEADER', 'Team Leader'),
      ('PROCUREMENT', 'Procurement'),
      ('DIRECTOR', 'Director'),
      ('FINANCE', 'Finance'),
      ('MD', 'Managing Director'),
      ('ADMIN', 'Admin')
    ON CONFLICT (code) DO NOTHING
  `);

  const hash = await hashPassword(password);
  const existing = await query<{ id: string }>(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2) LIMIT 1`,
    [EMAIL, USERNAME]
  );
  if (existing.rows[0]?.id) {
    await query(
      `UPDATE users SET
        email = $1,
        username = $2,
        name = 'Admin',
        role = 'ADMIN',
        password_hash = $3,
        is_active = TRUE
       WHERE id = $4`,
      [EMAIL, USERNAME, hash, existing.rows[0].id]
    );
    console.log(`Updated admin user ${EMAIL} (username: ${USERNAME}).`);
  } else {
    await query(
      `INSERT INTO users (email, username, name, role, password_hash, is_active, department)
       VALUES ($1, $2, 'Admin', 'ADMIN', $3, TRUE, 'IT')`,
      [EMAIL, USERNAME, hash]
    );
    console.log(`Created admin user ${EMAIL} (username: ${USERNAME}).`);
  }
  console.log("Password was taken from ADMIN_INITIAL_PASSWORD and is not printed.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
