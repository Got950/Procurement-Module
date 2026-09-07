import { prisma, query } from "@/lib/db";
import { buildMimeMessage, getGmailClient } from "@/server/gmail-service";
import { claimJobs, completeJob, failJob, recoverStaleJobs, type JobRow } from "@/server/jobs";
import { runGmailSync } from "@/server/gmail-sync";
import { readQuotationDocumentText } from "@/server/quotation-document-text";
import { log, newCorrelationId, withRequestContext } from "@/lib/logger";
import { emitMetric } from "@/lib/metrics";
import { contentHash } from "@/server/document-store";

let inFlight = 0;

export function getInFlightJobCount() {
  return inFlight;
}

export async function waitForIdle(timeoutMs = 25_000) {
  const start = Date.now();
  while (inFlight > 0 && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return inFlight === 0;
}

export async function processJobById(id: string) {
  const row = await query<JobRow>(
    `SELECT id, job_type, payload_json, idempotency_key, status, attempts, max_attempts, correlation_id
       FROM jobs WHERE id = $1`,
    [id]
  );
  const job = row.rows[0];
  if (!job) return;
  await runJob(job);
}

async function runJob(job: JobRow) {
  inFlight += 1;
  try {
    await withRequestContext(
      {
        correlationId: job.correlation_id?.trim() || newCorrelationId(),
        source: "JOB",
      },
      async () => {
        if (job.job_type === "email.send") {
          await handleEmailSend(job.payload_json as Record<string, unknown>);
        } else if (job.job_type === "gmail.sync") {
          const actorId = String((job.payload_json as { actorId?: string }).actorId ?? "system");
          await runGmailSync(actorId);
        } else if (job.job_type === "document.extract_text") {
          await handleExtractText(job.payload_json as Record<string, unknown>);
        } else if (job.job_type === "notification.fanout") {
          /* notifications are written inline today; job is a durable no-op placeholder */
        } else {
          throw new Error(`Unknown job type ${job.job_type}`);
        }
      }
    );
    await completeJob(job.id);
    emitMetric("JobSucceeded", 1, "Count", { jobType: job.job_type });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error("job failed", { jobId: job.id, jobType: job.job_type, error: message });
    await failJob(job.id, message, job.attempts, job.max_attempts);
    emitMetric("JobFailed", 1, "Count", { jobType: job.job_type });
  } finally {
    inFlight -= 1;
  }
}

async function handleEmailSend(payload: Record<string, unknown>) {
  const vendorId = String(payload.vendorId ?? "");
  const v = await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } });
  const subject = String(payload.subject ?? "").replace(/\{\{\s*company_name\s*\}\}/gi, v.companyName);
  const text = String(payload.bodyTemplate ?? "").replace(/\{\{\s*company_name\s*\}\}/gi, v.companyName);
  const mime = buildMimeMessage({
    to: v.email,
    subject,
    bodyText: `${text}\n\n---\nRef: ${payload.reference} / Item: ${payload.itemName}`,
  });
  const gmail = await getGmailClient();
  if (!gmail) throw new Error("Gmail not connected");
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: Buffer.from(mime).toString("base64url") },
  });
  const threadId = res.data.threadId ?? null;
  const rfqId = String(payload.rfqId ?? "");
  if (threadId && rfqId) {
    await query(`UPDATE rfqs SET gmail_thread_id = COALESCE(gmail_thread_id, $1) WHERE id = $2`, [
      threadId,
      rfqId,
    ]);
    await query(
      `UPDATE rfq_vendors SET gmail_thread_id = $1 WHERE rfq_id = $2 AND vendor_id = $3`,
      [threadId, rfqId, vendorId]
    );
  }
}

async function handleExtractText(payload: Record<string, unknown>) {
  const documentId = String(payload.documentId ?? "");
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) return;
  if (doc.extractedHash && doc.contentHash && doc.extractedHash === doc.contentHash && doc.extractedText) {
    return;
  }
  const text = await readQuotationDocumentText(doc.storagePath, doc.mimeType ?? "application/pdf");
  const hash = doc.contentHash ?? contentHash(Buffer.from(text));
  await query(
    `UPDATE documents SET extracted_text = $2, extracted_hash = $3, processing_status = 'READY'
      WHERE id = $1`,
    [documentId, text.slice(0, 200_000), hash]
  );
}

export async function drainOnce(workerId: string) {
  await recoverStaleJobs();
  const jobs = await claimJobs(5, workerId);
  await Promise.all(jobs.map((job) => runJob(job)));
  return jobs.length;
}
