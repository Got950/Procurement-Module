-- Up Migration
-- Baseline: the schema as it existed before migrations were tool-managed
-- (previously scripts/schema.sql). Fully idempotent, so it can be applied to an
-- existing database that already has these objects.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT UNIQUE NOT NULL,
  username TEXT,
  password_hash TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  department TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  uom TEXT NOT NULL,
  spec_notes TEXT,
  regulatory_tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_name TEXT NOT NULL,
  contact_person TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  city TEXT,
  gst_number TEXT,
  license_info TEXT,
  average_delivery_days INTEGER NOT NULL DEFAULT 14,
  payment_terms TEXT NOT NULL DEFAULT 'Net 30',
  rating DOUBLE PRECISION NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(vendor_id, item_id)
);

CREATE TABLE IF NOT EXISTS indents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reference TEXT UNIQUE NOT NULL,
  requester_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  quantity NUMERIC(18,4) NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  justification TEXT NOT NULL,
  estimated_amount NUMERIC(18,2),
  procurement_cost_commercial TEXT,
  procurement_delivery_expectations TEXT,
  procurement_specifications TEXT,
  approval_budget_amount NUMERIC(18,2),
  current_status TEXT NOT NULL DEFAULT 'DRAFT',
  rejection_reason TEXT,
  finance_budget_allocation TEXT,
  finance_budget_utilized TEXT,
  finance_available_balance TEXT,
  finance_funds_available TEXT,
  finance_account_no TEXT,
  finance_ifsc_code TEXT,
  finance_branch_name TEXT,
  finance_account_holder_name TEXT,
  finance_remarks TEXT,
  finance_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS indent_state_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  indent_id TEXT NOT NULL REFERENCES indents(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  indent_id TEXT NOT NULL REFERENCES indents(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL,
  remarks TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  indent_id TEXT NOT NULL REFERENCES indents(id) ON DELETE CASCADE,
  logical_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'OTHER',
  uploaded_by_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(indent_id, logical_key, version)
);

CREATE TABLE IF NOT EXISTS rfqs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  indent_id TEXT NOT NULL REFERENCES indents(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body_template TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  gmail_thread_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rfq_vendors (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  gmail_thread_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(rfq_id, vendor_id)
);

CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  indent_id TEXT NOT NULL REFERENCES indents(id) ON DELETE CASCADE,
  rfq_id TEXT REFERENCES rfqs(id),
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  document_id TEXT REFERENCES documents(id),
  unit_price NUMERIC(18,4),
  currency TEXT NOT NULL DEFAULT 'INR',
  moq NUMERIC(18,4),
  lead_time_days INTEGER,
  payment_terms TEXT,
  certifications JSONB,
  deviations JSONB,
  raw_extraction_json JSONB,
  ai_scores_json JSONB,
  summary_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_comparison_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  indent_id TEXT NOT NULL REFERENCES indents(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  weights_json JSONB NOT NULL,
  results_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_selection (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  indent_id TEXT UNIQUE NOT NULL REFERENCES indents(id) ON DELETE CASCADE,
  selected_vendor_id TEXT NOT NULL REFERENCES vendors(id),
  ai_recommended_vendor_id TEXT REFERENCES vendors(id),
  override_reason TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  indent_id TEXT NOT NULL REFERENCES indents(id) ON DELETE CASCADE,
  po_number TEXT UNIQUE NOT NULL,
  body_html TEXT NOT NULL,
  body_json JSONB,
  sent_at TIMESTAMPTZ,
  gmail_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  indent_id TEXT NOT NULL REFERENCES indents(id) ON DELETE CASCADE,
  purchase_order_id TEXT REFERENCES purchase_orders(id),
  vendor_name TEXT NOT NULL,
  amount NUMERIC(18,2),
  document_id TEXT REFERENCES documents(id),
  kind TEXT NOT NULL DEFAULT 'PROFORMA',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  indent_id TEXT NOT NULL REFERENCES indents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  proof_document_id TEXT REFERENCES documents(id),
  recorded_by_id TEXT REFERENCES users(id),
  paid_at TIMESTAMPTZ,
  vendor_proof_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  indent_id TEXT REFERENCES indents(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id),
  diff_json JSONB,
  indent_id TEXT REFERENCES indents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gmail_credentials (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT NOT NULL,
  refresh_enc TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gmail_ingested_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  gmail_message_id TEXT UNIQUE NOT NULL,
  indent_id TEXT REFERENCES indents(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Down Migration
-- Intentionally not reversible: dropping the baseline schema destroys all data.
-- To tear down a development database, drop and recreate the database instead.
SELECT 1;
