-- Up Migration
-- Folds in the parts of the previously orphaned scripts/migrations/*.sql that the
-- baseline did not already contain: the login lookup indexes and the role rows.
-- Everything else in those files (column additions) is already in 0001.

-- Pre-flight: these unique indexes fail on existing duplicates. Report them
-- explicitly instead of leaving the operator with a bare constraint violation.
DO $$
DECLARE
  dup TEXT;
BEGIN
  SELECT string_agg(t.k, ', ') INTO dup
  FROM (
    SELECT LOWER(email) AS k FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1
  ) t;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate users.email (case-insensitive): %. Resolve before migrating.', dup;
  END IF;

  SELECT string_agg(t.k, ', ') INTO dup
  FROM (
    SELECT LOWER(username) AS k FROM users
    WHERE username IS NOT NULL GROUP BY LOWER(username) HAVING COUNT(*) > 1
  ) t;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate users.username (case-insensitive): %. Resolve before migrating.', dup;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));

-- The MD role row was only ever in an orphaned migration, so a clean install
-- could not assign the MD role and the MD approval track was unreachable.
INSERT INTO roles (code, label) VALUES
  ('REQUESTER', 'Requester'),
  ('TEAM_LEADER', 'Team Leader'),
  ('PROCUREMENT', 'Procurement'),
  ('DIRECTOR', 'Director'),
  ('FINANCE', 'Finance'),
  ('MD', 'Managing Director'),
  ('ADMIN', 'Admin')
ON CONFLICT (code) DO NOTHING;

-- Down Migration
DROP INDEX IF EXISTS users_username_lower_idx;
DROP INDEX IF EXISTS users_email_lower_idx;
