import { describe, expect, it, beforeEach } from "vitest";
import { describeDb, resetData } from "../helpers/db";
import { enqueueJob, claimJobs, completeJob, failJob, recoverStaleJobs } from "@/server/jobs";
import { query } from "@/lib/db";

describeDb("jobs queue", () => {
  beforeEach(async () => {
    await resetData();
  });

  it("dedupes by idempotency key", async () => {
    const a = await enqueueJob({
      jobType: "notification.fanout",
      payload: { n: 1 },
      idempotencyKey: "fanout:1",
    });
    const b = await enqueueJob({
      jobType: "notification.fanout",
      payload: { n: 1 },
      idempotencyKey: "fanout:1",
    });
    expect(a).toBeTruthy();
    expect(b).toBeNull();
    const count = await query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM jobs`);
    expect(count.rows[0].c).toBe("1");
  });

  it("claims with SKIP LOCKED and completes", async () => {
    await enqueueJob({ jobType: "notification.fanout", payload: {} });
    const claimed = await claimJobs(5, "w1");
    expect(claimed).toHaveLength(1);
    await completeJob(claimed[0].id);
    const row = await query<{ status: string }>(`SELECT status FROM jobs WHERE id = $1`, [
      claimed[0].id,
    ]);
    expect(row.rows[0].status).toBe("SUCCEEDED");
  });

  it("retries then dead-letters", async () => {
    const id = await enqueueJob({
      jobType: "notification.fanout",
      payload: {},
      maxAttempts: 2,
    });
    const first = await claimJobs(1, "w1");
    expect(first[0].id).toBe(id);
    await failJob(first[0].id, "boom", first[0].attempts, first[0].max_attempts);
    await query(`UPDATE jobs SET run_after = NOW() - INTERVAL '1 second' WHERE id = $1`, [id]);
    const second = await claimJobs(1, "w1");
    expect(second).toHaveLength(1);
    await failJob(second[0].id, "boom", second[0].attempts, second[0].max_attempts);
    const row = await query<{ status: string }>(`SELECT status FROM jobs WHERE id = $1`, [id!]);
    expect(row.rows[0].status).toBe("DEAD");
  });

  it("recovers stale RUNNING jobs", async () => {
    const id = await enqueueJob({ jobType: "notification.fanout", payload: {} });
    await query(
      `UPDATE jobs SET status = 'RUNNING', locked_at = NOW() - INTERVAL '30 minutes', locked_by = 'dead'
        WHERE id = $1`,
      [id]
    );
    await recoverStaleJobs(10);
    const row = await query<{ status: string }>(`SELECT status FROM jobs WHERE id = $1`, [id!]);
    expect(row.rows[0].status).toBe("PENDING");
  });
});
