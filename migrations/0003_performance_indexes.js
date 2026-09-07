/**
 * The schema had no non-constraint index at all, so every list, lookup and
 * child-table fetch was a sequential scan. Built CONCURRENTLY and outside a
 * transaction so applying this to a live database does not block writes.
 */
exports.disableTransaction = true;

const INDEXES = [
  ["idx_indents_status_updated", "indents (current_status, updated_at DESC)"],
  ["idx_indents_requester", "indents (requester_id, created_at DESC)"],
  ["idx_indent_state_hist_indent", "indent_state_history (indent_id, created_at)"],
  ["idx_approval_events_indent", "approval_events (indent_id, created_at)"],
  ["idx_documents_indent", "documents (indent_id, created_at DESC)"],
  ["idx_quotations_indent", "quotations (indent_id)"],
  ["idx_quotations_vendor", "quotations (vendor_id)"],
  ["idx_rfqs_indent", "rfqs (indent_id, sent_at DESC)"],
  ["idx_rfqs_thread", "rfqs (gmail_thread_id) WHERE gmail_thread_id IS NOT NULL"],
  ["idx_rfq_vendors_rfq", "rfq_vendors (rfq_id)"],
  ["idx_rfq_vendors_thread", "rfq_vendors (gmail_thread_id) WHERE gmail_thread_id IS NOT NULL"],
  ["idx_notifications_user_unread", "notifications (user_id, read_at, created_at DESC)"],
  ["idx_audit_indent", "audit_logs (indent_id, created_at DESC)"],
  ["idx_audit_entity", "audit_logs (entity_type, entity_id, created_at DESC)"],
  ["idx_invoices_indent_kind", "invoices (indent_id, kind, created_at DESC)"],
  ["idx_payments_indent", "payments (indent_id)"],
  ["idx_vendor_items_item", "vendor_items (item_id)"],
];

exports.up = async (pgm) => {
  for (const [name, definition] of INDEXES) {
    await pgm.db.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON ${definition}`);
  }
};

exports.down = async (pgm) => {
  for (const [name] of INDEXES) {
    await pgm.db.query(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`);
  }
};
