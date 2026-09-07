/**
 * Remove all indent / procurement case data. Keeps users, items, vendors, vendor_items.
 * Gmail OAuth credentials are kept so Connect Gmail still works.
 */
import "dotenv/config";
import { rm } from "fs/promises";
import path from "path";
import { query } from "../src/lib/db";
import { assertDestructiveAllowed } from "./destructive-guard";

async function main() {
  assertDestructiveAllowed("db:clear-indents");
  await query(`
    TRUNCATE TABLE
      notifications,
      audit_logs,
      gmail_ingested_messages,
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
      indents
    RESTART IDENTITY CASCADE
  `);

  const uploadsDir = path.join(process.cwd(), "data", "uploads");
  try {
    await rm(uploadsDir, { recursive: true, force: true });
  } catch {
    /* ok if missing */
  }

  const [users, vendors, items] = await Promise.all([
    query<{ n: string }>("SELECT COUNT(*)::text AS n FROM users"),
    query<{ n: string }>("SELECT COUNT(*)::text AS n FROM vendors"),
    query<{ n: string }>("SELECT COUNT(*)::text AS n FROM items"),
  ]);

  console.log("Cleared all indents and related data (RFQs, quotes, POs, notifications, uploads).");
  console.log(`Kept: ${users.rows[0]?.n ?? 0} users, ${vendors.rows[0]?.n ?? 0} vendors, ${items.rows[0]?.n ?? 0} items.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
