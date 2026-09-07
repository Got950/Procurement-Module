/**
 * The 21 statuses and every other enum existed only as TypeScript constants, so
 * any script or manual UPDATE could leave a row in a state no handler expects.
 *
 * Each constraint is added NOT VALID first and validated separately, so the long
 * ACCESS EXCLUSIVE lock of a full-table check is avoided. Out-of-band values are
 * reported up front rather than discovered as a failed deployment.
 */
exports.disableTransaction = true;

const INDENT_STATUSES = [
  "DRAFT",
  "PENDING_TL_INDENT",
  "REJECTED_TL_INDENT",
  "PROCUREMENT_ACTIVE",
  "RFQ_SENT",
  "AWAITING_QUOTES",
  "QUOTES_READY",
  "PENDING_TL_VENDOR",
  "REJECTED_TL_VENDOR",
  "PENDING_DIRECTOR",
  "REJECTED_DIRECTOR",
  "PENDING_MD",
  "REJECTED_MD",
  "PROCUREMENT_PO",
  "PO_DRAFT",
  "PO_SENT",
  "AWAITING_INVOICE",
  "PENDING_FINANCE",
  "PAYMENT_DONE",
  "PENDING_FINANCE_FINAL",
  "PAYMENT_PROOF_TO_VENDOR",
  "CLOSED",
];

const CONSTRAINTS = [
  ["indents", "current_status", "chk_indents_current_status", INDENT_STATUSES],
  [
    "users",
    "role",
    "chk_users_role",
    ["REQUESTER", "TEAM_LEADER", "PROCUREMENT", "DIRECTOR", "MD", "FINANCE", "ADMIN"],
  ],
  ["payments", "status", "chk_payments_status", ["PENDING", "COMPLETED"]],
  ["invoices", "kind", "chk_invoices_kind", ["PROFORMA", "FINAL"]],
  [
    "documents",
    "type",
    "chk_documents_type",
    ["INDENT_ATTACHMENT", "QUOTATION", "PURCHASE_ORDER", "INVOICE", "PAYMENT_PROOF", "OTHER"],
  ],
  ["approval_events", "decision", "chk_approval_events_decision", ["APPROVED", "REJECTED"]],
  [
    "approval_events",
    "stage",
    "chk_approval_events_stage",
    ["TEAM_LEADER_INDENT", "TEAM_LEADER_VENDOR", "DIRECTOR_VENDOR", "MD_VENDOR"],
  ],
  ["vendors", "status", "chk_vendors_status", ["ACTIVE", "INACTIVE", "PENDING"]],
  [
    "notifications",
    "type",
    "chk_notifications_type",
    [
      "STATUS_CHANGE",
      "APPROVAL_REQUIRED",
      "REJECTION",
      "RFQ_SENT",
      "QUOTE_RECEIVED",
      "VENDOR_GMAIL",
      "PAYMENT",
      "SYSTEM",
    ],
  ],
];

const list = (values) => values.map((v) => `'${v}'`).join(", ");

exports.up = async (pgm) => {
  const problems = [];
  for (const [table, column, , values] of CONSTRAINTS) {
    const { rows } = await pgm.db.query(
      `SELECT DISTINCT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND ${column} NOT IN (${list(values)})`
    );
    for (const row of rows) problems.push(`${table}.${column} = '${row.value}'`);
  }
  if (problems.length > 0) {
    throw new Error(`Out-of-band enum values must be corrected first -> ${problems.join(", ")}`);
  }

  for (const [table, column, name, values] of CONSTRAINTS) {
    await pgm.db.query(
      `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`
    );
    await pgm.db.query(
      `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${column} IN (${list(values)})) NOT VALID`
    );
    await pgm.db.query(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${name}`);
  }
};

exports.down = async (pgm) => {
  for (const [table, , name] of CONSTRAINTS) {
    await pgm.db.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
  }
};
