import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { idParam, rfqSendBody } from "@/lib/schemas";
import { prisma, withTransaction, query } from "@/lib/db";
import { canProcurement } from "@/lib/rbac/policies";
import { AuthorizationError, ConflictError, ValidationError, UnauthorizedError } from "@/lib/errors";
import { indentUseCases } from "@/server/application/indent-use-cases";
import { getGmailClient } from "@/server/gmail-service";
import { enqueueJob } from "@/server/jobs";
import { processJobById } from "@/server/job-handlers";
import { getCorrelationId } from "@/lib/logger";

const SENDABLE = new Set(["PROCUREMENT_ACTIVE", "AWAITING_QUOTES", "QUOTES_READY", "RFQ_SENT"]);

export const POST = withApiHandler({
  idempotent: true,
  params: idParam,
  body: rfqSendBody,
})(async ({ session, params, body }) => {
  if (!session) throw new UnauthorizedError();
  if (!canProcurement(session.role)) throw new AuthorizationError();
  const indent = await prisma.indent.findUniqueOrThrow({
    where: { id: params.id },
    include: { item: true },
  });
  if (!SENDABLE.has(indent.currentStatus)) {
    throw new ConflictError(
      `Cannot send an RFQ while the case is at ${indent.currentStatus}. Refresh and retry.`
    );
  }
  const gmail = await getGmailClient();
  if (!gmail) {
    throw new ValidationError(
      "Gmail not connected. Click 'Connect Gmail' first and complete consent, then retry send enquiry."
    );
  }
  const jobIds: string[] = [];
  const rfq = await withTransaction(async () => {
    const created = await indentUseCases.createRfq(
      { id: session.sub, role: session.role },
      params.id,
      body
    );
    for (const vendorId of body.vendorIds) {
      const jobId = await enqueueJob({
        jobType: "email.send",
        payload: {
          kind: "rfq",
          indentId: params.id,
          rfqId: created.id,
          vendorId,
          subject: body.subject,
          bodyTemplate: body.bodyTemplate,
          reference: indent.reference,
          itemName: indent.item.name,
        },
        idempotencyKey: `email.send:rfq:${created.id}:${vendorId}`,
        correlationId: getCorrelationId(),
      });
      if (jobId) jobIds.push(jobId);
    }
    return created;
  });
  if (process.env.JOBS_INLINE === "1") {
    for (const jobId of jobIds) await processJobById(jobId);
    const statuses = await Promise.all(
      jobIds.map(async (id) => {
        const row = await query<{ status: string; last_error: string | null }>(
          `SELECT status, last_error FROM jobs WHERE id = $1`,
          [id]
        );
        return row.rows[0];
      })
    );
    const failed = statuses.filter((s) => s && s.status !== "SUCCEEDED");
    if (failed.length > 0) {
      const detail = failed
        .map((s) => s?.last_error)
        .filter(Boolean)
        .slice(0, 2)
        .join("; ");
      const gmailDisconnected = failed.some((s) =>
        String(s?.last_error ?? "").toLowerCase().includes("gmail not connected")
      );
      throw new ValidationError(
        gmailDisconnected
          ? "Gmail not connected. Connect Gmail, then retry send enquiry. RFQ was saved but emails were not sent."
          : `RFQ was saved but email delivery failed${detail ? `: ${detail}` : ""}. Retry after fixing Gmail.`
      );
    }
    return NextResponse.json({
      rfq,
      emailed: true,
      queued: false,
      sentCount: body.vendorIds.length,
      message: `RFQ sent to ${body.vendorIds.length} vendor(s).`,
    });
  }
  return NextResponse.json(
    {
      rfq,
      emailed: false,
      queued: true,
      sentCount: body.vendorIds.length,
      message: `RFQ queued for ${body.vendorIds.length} vendor(s). Delivery runs when the job worker processes the queue.`,
    },
    { status: 202 }
  );
});
