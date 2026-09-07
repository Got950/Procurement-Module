-- Speeds recoverStaleJobs (RUNNING + locked_at). Non-concurrent so it works
-- inside node-pg-migrate's default transaction (expand-only, low row impact).
CREATE INDEX IF NOT EXISTS idx_jobs_running_locked
  ON jobs (locked_at)
  WHERE status = 'RUNNING';
