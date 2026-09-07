import { query, withTransaction } from "@/lib/db";

export type JobRow = {
  id: string;
  job_type: string;
  payload_json: unknown;
  idempotency_key: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  correlation_id: string | null;
};

export async function enqueueJob(params: {
  jobType: string;
  payload: unknown;
  idempotencyKey?: string;
  correlationId?: string | null;
  maxAttempts?: number;
}) {
  const result = await query<{ id: string }>(
    `INSERT INTO jobs (job_type, payload_json, idempotency_key, correlation_id, max_attempts)
     VALUES ($1, $2::jsonb, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      params.jobType,
      JSON.stringify(params.payload),
      params.idempotencyKey ?? null,
      params.correlationId ?? null,
      params.maxAttempts ?? 5,
    ]
  );
  return result.rows[0]?.id ?? null;
}

export async function claimJobs(limit: number, workerId: string): Promise<JobRow[]> {
  return withTransaction(async () => {
    const result = await query<JobRow>(
      `UPDATE jobs SET status = 'RUNNING', locked_at = NOW(), locked_by = $2, attempts = attempts + 1, updated_at = NOW()
        WHERE id IN (
          SELECT id FROM jobs
           WHERE status = 'PENDING' AND run_after <= NOW()
           ORDER BY run_after
           FOR UPDATE SKIP LOCKED
           LIMIT $1
        )
        RETURNING id, job_type, payload_json, idempotency_key, status, attempts, max_attempts, correlation_id`,
      [limit, workerId]
    );
    return result.rows;
  });
}

export async function completeJob(id: string) {
  await query(
    `UPDATE jobs SET status = 'SUCCEEDED', locked_at = NULL, updated_at = NOW() WHERE id = $1`,
    [id]
  );
}

export async function failJob(id: string, error: string, attempts: number, maxAttempts: number) {
  const dead = attempts >= maxAttempts;
  const delaySec = Math.min(30 * 2 ** Math.max(0, attempts - 1), 480);
  await query(
    `UPDATE jobs
        SET status = $2,
            last_error = $3,
            locked_at = NULL,
            run_after = CASE WHEN $2 = 'PENDING' THEN NOW() + make_interval(secs => $4) ELSE run_after END,
            updated_at = NOW()
      WHERE id = $1`,
    [id, dead ? "DEAD" : "PENDING", error.slice(0, 2000), delaySec]
  );
}

export async function recoverStaleJobs(timeoutMinutes = 10) {
  await query(
    `UPDATE jobs SET status = 'PENDING', locked_at = NULL, updated_at = NOW()
      WHERE status = 'RUNNING' AND locked_at < NOW() - make_interval(mins => $1)`,
    [timeoutMinutes]
  );
}
