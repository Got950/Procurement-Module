-- Up Migration
-- `updated_at` was set once at insert and never maintained, while the indent
-- list sorts by it. The trigger makes the column mean what its name says.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'items', 'vendors', 'indents', 'rfqs', 'quotations',
    'vendor_selection', 'purchase_orders', 'payments', 'gmail_credentials'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t
    );
  END LOOP;
END $$;

-- Down Migration
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'items', 'vendors', 'indents', 'rfqs', 'quotations',
    'vendor_selection', 'purchase_orders', 'payments', 'gmail_credentials'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', t);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS set_updated_at();
