/**
 * Upserts local demo users for each role (non-destructive).
 * Password: DEMO_USER_PASSWORD, or ADMIN_INITIAL_PASSWORD if unset.
 * Does not truncate data and does not touch the admin identity from seed-admin.
 *
 *   npm run db:seed-demo-users
 */
import "dotenv/config";
import { query } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

/** Realistic local accounts — not the old pharma-demo placeholder identities. */
const DEMO_USERS = [
  {
    email: "ananya.mehta@must.co.in",
    username: "ananya.mehta",
    name: "Ananya Mehta",
    role: "REQUESTER",
    department: "R&D",
  },
  {
    email: "rohan.kapoor@must.co.in",
    username: "rohan.kapoor",
    name: "Rohan Kapoor",
    role: "TEAM_LEADER",
    department: "R&D",
  },
  {
    email: "kavitha.iyer@must.co.in",
    username: "kavitha.iyer",
    name: "Kavitha Iyer",
    role: "PROCUREMENT",
    department: "Procurement",
  },
  {
    email: "suresh.menon@must.co.in",
    username: "suresh.menon",
    name: "Suresh Menon",
    role: "DIRECTOR",
    department: "Operations",
  },
  {
    email: "meera.krishnan@must.co.in",
    username: "meera.krishnan",
    name: "Meera Krishnan",
    role: "MD",
    department: "Executive",
  },
  {
    email: "arjun.desai@must.co.in",
    username: "arjun.desai",
    name: "Arjun Desai",
    role: "FINANCE",
    department: "Finance",
  },
] as const;

/** Previous placeholder accounts removed so User management stays clean. */
const LEGACY_DEMO_EMAILS = [
  "john.smith@pharma-demo.local",
  "sarah.johnson@pharma-demo.local",
  "mike.chen@pharma-demo.local",
  "elena.rossi@pharma-demo.local",
  "priya.nair@pharma-demo.local",
  "david.lee@pharma-demo.local",
  "admin@pharma-demo.local",
];

async function main() {
  const password =
    process.env.DEMO_USER_PASSWORD?.trim() || process.env.ADMIN_INITIAL_PASSWORD?.trim();
  if (!password || password.length < 12) {
    throw new Error(
      "Set DEMO_USER_PASSWORD or ADMIN_INITIAL_PASSWORD to at least 12 characters"
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

  await query(`DELETE FROM users WHERE LOWER(email) = ANY($1::text[])`, [
    LEGACY_DEMO_EMAILS.map((e) => e.toLowerCase()),
  ]);

  const hash = await hashPassword(password);
  let created = 0;
  let updated = 0;

  for (const u of DEMO_USERS) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2) LIMIT 1`,
      [u.email, u.username]
    );
    if (existing.rows[0]?.id) {
      await query(
        `UPDATE users SET
           email = $1, username = $2, name = $3, role = $4, department = $5,
           password_hash = $6, is_active = TRUE
         WHERE id = $7`,
        [u.email, u.username, u.name, u.role, u.department, hash, existing.rows[0].id]
      );
      updated += 1;
    } else {
      await query(
        `INSERT INTO users (email, username, name, role, department, password_hash, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
        [u.email, u.username, u.name, u.role, u.department, hash]
      );
      created += 1;
    }
  }

  console.log(`Users ready: ${created} created, ${updated} updated (legacy demo emails removed).`);
  console.log("Password from DEMO_USER_PASSWORD or ADMIN_INITIAL_PASSWORD (not printed).");
  for (const u of DEMO_USERS) {
    console.log(`  ${u.role.padEnd(12)} ${u.name} <${u.email}>`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
