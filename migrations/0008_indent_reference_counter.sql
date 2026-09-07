-- Up Migration
-- References were `IND-{year}-{count()+1}`, so two concurrent creations computed
-- the same value and one request died on the unique constraint. This counter is
-- allocated with a single atomic upsert instead.
CREATE TABLE IF NOT EXISTS indent_reference_counters (
  year INTEGER PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0
);

-- Seed from existing references so no already-issued number can be reused.
INSERT INTO indent_reference_counters (year, last_value)
SELECT
  CAST(split_part(reference, '-', 2) AS INTEGER) AS year,
  MAX(CAST(split_part(reference, '-', 3) AS INTEGER)) AS last_value
FROM indents
WHERE reference ~ '^IND-[0-9]{4}-[0-9]+$'
GROUP BY 1
ON CONFLICT (year) DO UPDATE
  SET last_value = GREATEST(indent_reference_counters.last_value, EXCLUDED.last_value);

-- Down Migration
DROP TABLE IF EXISTS indent_reference_counters;
