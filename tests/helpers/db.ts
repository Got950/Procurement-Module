import { describe } from "vitest";
import { useTestDatabase } from "./test-db";
import { query } from "@/lib/db";

// src/lib/db resolves DATABASE_URL lazily on first query, so redirecting it here
// is enough to keep the application pool inside the test database.
useTestDatabase();

/** Integration suites skip when no local PostgreSQL is available (never in CI). */
export const describeDb = describe.skipIf(process.env.TEST_DB_UNAVAILABLE === "1");

const TABLES = [
  "password_reset_tokens",
  "copilot_confirmations",
  "copilot_tool_executions",
  "copilot_messages",
  "copilot_conversations",
  "notifications",
  "audit_logs",
  "gmail_ingested_messages",
  "gmail_messages",
  "gmail_sync_state",
  "sessions",
  "jobs",
  "idempotency_keys",
  "payments",
  "invoices",
  "purchase_orders",
  "ai_comparison_runs",
  "quotations",
  "rfq_vendors",
  "rfqs",
  "vendor_selection",
  "approval_events",
  "indent_state_history",
  "documents",
  "indents",
  "vendor_items",
  "vendors",
  "items",
  "users",
];

export async function resetData() {
  await query(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export async function createUser(role: string, name = `${role} user`) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const result = await query<{ id: string }>(
    `INSERT INTO users (email, username, name, role, department, is_active)
     VALUES ($1, $2, $3, $4, 'Test', TRUE) RETURNING id`,
    [`${role.toLowerCase()}.${suffix}@test.local`, `${role.toLowerCase()}.${suffix}`, name, role]
  );
  return result.rows[0].id;
}

export async function createItem() {
  const suffix = Math.random().toString(36).slice(2, 10);
  const result = await query<{ id: string }>(
    `INSERT INTO items (sku, name, category, uom) VALUES ($1, 'Test item', 'API', 'KG') RETURNING id`,
    [`SKU-${suffix}`]
  );
  return result.rows[0].id;
}

export async function createVendor(email: string) {
  const result = await query<{ id: string }>(
    `INSERT INTO vendors (company_name, contact_person, email) VALUES ('Test Vendor', 'Contact', $1) RETURNING id`,
    [email]
  );
  return result.rows[0].id;
}

export async function createIndent(params: {
  requesterId: string;
  itemId: string;
  status?: string;
  approvalBudgetAmount?: number | null;
}) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const result = await query<{ id: string }>(
    `INSERT INTO indents (reference, requester_id, item_id, quantity, justification, current_status, approval_budget_amount)
     VALUES ($1, $2, $3, 10, 'Test justification', $4, $5) RETURNING id`,
    [
      `IND-TEST-${suffix}`,
      params.requesterId,
      params.itemId,
      params.status ?? "DRAFT",
      params.approvalBudgetAmount ?? null,
    ]
  );
  return result.rows[0].id;
}

export async function createDocument(
  indentId: string,
  logicalKey: string,
  opts?: { extractedText?: string; filename?: string }
) {
  const result = await query<{ id: string }>(
    `INSERT INTO documents (indent_id, logical_key, version, filename, storage_path, mime_type, type, extracted_text)
     VALUES ($1, $2, 1, $3, 'test/test.pdf', 'application/pdf', 'OTHER', $4) RETURNING id`,
    [indentId, logicalKey, opts?.filename ?? "test.pdf", opts?.extractedText ?? null]
  );
  return result.rows[0].id;
}

export async function statusOf(indentId: string) {
  const result = await query<{ current_status: string }>(
    "SELECT current_status FROM indents WHERE id = $1",
    [indentId]
  );
  return result.rows[0]?.current_status ?? null;
}
