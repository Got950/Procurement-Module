import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import {
  AuthorizationError,
  UnauthorizedError,
  ValidationError,
  NotFoundError,
} from "@/lib/errors";
import { prisma, query } from "@/lib/db";
import { canProcurement } from "@/lib/rbac/policies";
import { getGmailClient } from "@/server/gmail-service";
import { contentDispositionAttachment } from "@/server/document-store";

async function messageAllowedForIndent(
  gmail: NonNullable<Awaited<ReturnType<typeof getGmailClient>>>,
  indentId: string,
  messageId: string
): Promise<boolean> {
  const msg = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["Subject"],
  });
  const tid = msg.data.threadId;
  if (!tid) return false;
  const r = await query(
    `SELECT 1 FROM rfqs WHERE indent_id = $1 AND gmail_thread_id = $2 LIMIT 1`,
    [indentId, tid]
  );
  return r.rows.length > 0;
}

const attachmentQuery = z.object({
  messageId: z.string().min(1),
  attachmentId: z.string().min(1),
  mimeType: z.string().optional(),
  filename: z.string().optional(),
});

export const GET = withApiHandler({
  params: idParam,
  query: attachmentQuery,
  body: false,
})(async ({ session, params, query }) => {
  if (!session) throw new UnauthorizedError();
  if (!canProcurement(session.role)) throw new AuthorizationError();

  const indentId = params.id;
  const messageId = query.messageId.trim();
  const attachmentId = query.attachmentId.trim();
  const rawMime = query.mimeType?.trim() || "application/octet-stream";
  const mimeHint = /^[a-z0-9.+\/-]+$/i.test(rawMime) ? rawMime : "application/octet-stream";
  if (!messageId || !attachmentId) {
    throw new ValidationError("messageId and attachmentId required");
  }

  const indent = await prisma.indent.findUnique({ where: { id: indentId } });
  if (!indent) throw new NotFoundError();

  const gmail = await getGmailClient();
  if (!gmail) throw new ValidationError("Gmail not connected");

  const ok = await messageAllowedForIndent(gmail, indentId, messageId);
  if (!ok) throw new AuthorizationError("Message not linked to this indent");

  const att = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });
  const raw = att.data.data;
  if (!raw) throw new NotFoundError("Empty attachment");

  const buf = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const filename =
    query.filename?.replace(/[^\w.\- ()\[\]]+/g, "_").slice(0, 200) || "attachment";

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": mimeHint.includes("/") ? mimeHint : "application/octet-stream",
      "Content-Disposition": contentDispositionAttachment(filename, { requirePdf: false }),
      "Cache-Control": "private, max-age=3600",
    },
  });
});
