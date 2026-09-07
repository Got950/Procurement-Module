/**
 * Local destructive reset: wipes application data, then ensures roles, one
 * ADMIN from environment, and local users for each operational role.
 *
 * Keeps gmail_credentials so Connect Gmail stays intact.
 *
 *   ALLOW_DESTRUCTIVE=1 npm run db:seed
 *
 * Prefer `npm run db:seed-admin` when you only need the admin user.
 * Prefer `npm run db:seed-demo-users` to add role users without wiping.
 */
import "dotenv/config";
import { query } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { assertDestructiveAllowed } from "./destructive-guard";

const EMAIL = process.env.ADMIN_EMAIL ?? "admin@must.co.in";
const USERNAME = process.env.ADMIN_USERNAME ?? "admin";

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

async function main() {
  assertDestructiveAllowed("db:seed");

  const password = process.env.ADMIN_INITIAL_PASSWORD?.trim();
  if (!password || password.length < 12) {
    throw new Error(
      "ADMIN_INITIAL_PASSWORD must be set to at least 12 characters before seeding"
    );
  }

  await query(`
    TRUNCATE TABLE
      copilot_confirmations,
      copilot_tool_executions,
      copilot_messages,
      copilot_conversations,
      notifications,
      audit_logs,
      gmail_ingested_messages,
      gmail_messages,
      gmail_sync_state,
      payments,
      invoices,
      purchase_orders,
      ai_comparison_runs,
      quotations,
      rfq_vendors,
      rfqs,
      vendor_selection,
      approval_events,
      indent_state_history,
      documents,
      indents,
      vendor_items,
      vendors,
      items,
      jobs,
      idempotency_keys,
      sessions,
      users
    RESTART IDENTITY CASCADE
  `);

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
  await query(
    `INSERT INTO users (email, username, name, role, department, password_hash, is_active)
     VALUES ($1, $2, 'Admin', 'ADMIN', 'IT', $3, TRUE)`,
    [EMAIL, USERNAME, hash]
  );

  for (const u of DEMO_USERS) {
    await query(
      `INSERT INTO users (email, username, name, role, department, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
      [u.email, u.username, u.name, u.role, u.department, hash]
    );
  }

  console.log(
    `Seed reset complete. Admin ${EMAIL} (username: ${USERNAME}) + ${DEMO_USERS.length} users created.`
  );
  console.log("Password taken from ADMIN_INITIAL_PASSWORD (not printed).");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
