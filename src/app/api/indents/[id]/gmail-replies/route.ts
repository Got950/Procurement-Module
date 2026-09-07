import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { AuthorizationError, UnauthorizedError, NotFoundError } from "@/lib/errors";
import { prisma, query } from "@/lib/db";
import { canProcurement } from "@/lib/rbac/policies";
import { getGmailClient } from "@/server/gmail-service";
import { listStoredReplies } from "@/server/gmail-sync";
import {
  canonicalEmailForCompare,
  gmailThreadOrMessageWebUrl,
  isGmailSentMessage,
  looksLikeOutboundRfqText,
  looksLikeVendorReplyText,
  parseFromEmail,
  vendorEmailMatches,
} from "@/lib/gmail-address";

type GmailAttachMeta = {
  filename: string;
  mimeType: string;
  size: number;
  downloadHref: string;
};

type VendorGmailReply = {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  internalMs: number;
  gmailUrl: string;
  attachments: GmailAttachMeta[];
};

type MsgPart = {
  mimeType?: string | null;
  filename?: string | null;
  body?: { attachmentId?: string | null; size?: number | null } | null;
  parts?: MsgPart[];
};

function walkAttachmentParts(
  part: MsgPart | undefined | null,
  out: { id: string; fn: string; mime: string; size: number }[]
) {
  if (!part) return;
  if (part.parts) for (const c of part.parts) walkAttachmentParts(c, out);
  const id = part.body?.attachmentId;
  const fn = part.filename?.trim();
  if (id && fn) {
    out.push({
      id,
      fn,
      mime: part.mimeType || "application/octet-stream",
      size: Number(part.body?.size ?? 0),
    });
  }
}

async function attachmentsForMessage(
  gmail: NonNullable<Awaited<ReturnType<typeof getGmailClient>>>,
  indentId: string,
  messageId: string
): Promise<GmailAttachMeta[]> {
  const full = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const collected: { id: string; fn: string; mime: string; size: number }[] = [];
  walkAttachmentParts(full.data.payload as MsgPart, collected);
  return collected.map((a) => ({
    filename: a.fn,
    mimeType: a.mime,
    size: a.size,
    downloadHref: `/api/indents/${encodeURIComponent(indentId)}/gmail-attachments?messageId=${encodeURIComponent(messageId)}&attachmentId=${encodeURIComponent(a.id)}&filename=${encodeURIComponent(a.fn)}&mimeType=${encodeURIComponent(a.mime)}`,
  }));
}

function mapStoredAttachments(
  indentId: string,
  messageId: string,
  attachments: unknown
): GmailAttachMeta[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.map((raw) => {
    const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const filename = typeof a.filename === "string" ? a.filename : "attachment";
    const mimeType = typeof a.mimeType === "string" ? a.mimeType : "application/octet-stream";
    const attachmentId =
      typeof a.attachmentId === "string"
        ? a.attachmentId
        : typeof a.id === "string"
          ? a.id
          : "";
    const size = typeof a.size === "number" ? a.size : 0;
    return {
      filename,
      mimeType,
      size,
      downloadHref: `/api/indents/${encodeURIComponent(indentId)}/gmail-attachments?messageId=${encodeURIComponent(messageId)}&attachmentId=${encodeURIComponent(attachmentId)}&filename=${encodeURIComponent(filename)}&mimeType=${encodeURIComponent(mimeType)}`,
    };
  });
}

function readHeaders(payload: unknown) {
  const headers =
    (payload as { headers?: { name?: string | null; value?: string | null }[] | null } | null)?.headers ??
    [];
  const m = new Map(headers.map((h) => [String(h.name ?? "").toLowerCase(), h.value ?? ""]));
  return {
    from: m.get("from") ?? "",
    subject: m.get("subject") ?? "",
  };
}

export const GET = withApiHandler({
  params: idParam,
  body: false,
})(async ({ session, params }) => {
  if (!session) throw new UnauthorizedError();
  if (!canProcurement(session.role)) throw new AuthorizationError();

  const indentId = params.id;
  const indent = await prisma.indent.findUnique({ where: { id: indentId } });
  if (!indent) throw new NotFoundError();

  const ref = String(indent.reference ?? "").trim();
  if (!ref) return NextResponse.json({ replies: [] as VendorGmailReply[] });

  const stored = await listStoredReplies(indentId);
  if (stored.length > 0) {
    const cred = await prisma.gmailCredential.findFirst();
    const replies: VendorGmailReply[] = stored.map((row) => ({
      messageId: row.messageId,
      threadId: row.threadId,
      from: row.from,
      subject: row.subject,
      snippet: row.snippet,
      internalMs: row.internalMs,
      gmailUrl: gmailThreadOrMessageWebUrl(row.threadId, row.messageId),
      attachments: mapStoredAttachments(indentId, row.messageId, row.attachments),
    }));
    return NextResponse.json({
      replies,
      connectedInbox: cred?.email ?? null,
    });
  }

  const gmail = await getGmailClient();
  if (!gmail) {
    return NextResponse.json({ replies: [] as VendorGmailReply[], error: "Gmail not connected" });
  }

  const cred = await prisma.gmailCredential.findFirst();
  const inboxCanon = cred?.email ? canonicalEmailForCompare(cred.email.trim()) : "";

  const vendorRows = await query<{ email: string }>(
    `SELECT DISTINCT LOWER(TRIM(v.email)) AS email
     FROM rfq_vendors rv
     INNER JOIN rfqs r ON r.id = rv.rfq_id
     INNER JOIN vendors v ON v.id = rv.vendor_id
     WHERE r.indent_id = $1 AND v.email IS NOT NULL AND TRIM(v.email) <> ''`,
    [indentId]
  );
  const vendorEmails = new Set(
    (vendorRows.rows as { email?: string }[])
      .map((r) => r.email?.trim().toLowerCase())
      .filter(Boolean) as string[]
  );

  const threadRows = await query<{ gmail_thread_id: string }>(
    `SELECT DISTINCT gmail_thread_id FROM (
       SELECT gmail_thread_id FROM rfqs
       WHERE indent_id = $1 AND gmail_thread_id IS NOT NULL
       UNION
       SELECT rv.gmail_thread_id FROM rfq_vendors rv
       INNER JOIN rfqs r ON r.id = rv.rfq_id
       WHERE r.indent_id = $1 AND rv.gmail_thread_id IS NOT NULL
     ) t
     WHERE gmail_thread_id IS NOT NULL`,
    [indentId]
  );

  const now = Date.now();
  const maxAge = 30 * 86400000;
  const byId = new Map<string, VendorGmailReply>();

  const consider = (args: {
    id: string;
    threadId: string;
    internalMs: number;
    fromHeader: string;
    subject: string;
    snippet: string;
    labelIds?: string[] | null;
    /** If true, message is in an RFQ thread for this indent — do not require subject to contain ref. */
    inRfqThread: boolean;
  }) => {
    if (!args.id || !args.internalMs) return;
    if (looksLikeOutboundRfqText(args.snippet, args.subject)) return;
    if (now - args.internalMs > maxAge || now - args.internalMs < -120_000) return;
    const addr = parseFromEmail(args.fromHeader);
    const isSelf = Boolean(inboxCanon && canonicalEmailForCompare(addr) === inboxCanon);
    const isSent = isGmailSentMessage(args.labelIds);
    const vendorReply = looksLikeVendorReplyText(args.snippet, args.subject);
    const vendorOk = vendorEmailMatches(addr, vendorEmails);
    const snippetTrim = (args.snippet ?? "").trim();
    const subjectLower = args.subject.toLowerCase();
    const isRe = subjectLower.includes("re:");

    const refInText =
      subjectLower.includes(ref.toLowerCase()) ||
      snippetTrim.toLowerCase().includes(ref.toLowerCase());

    /**
     * In RFQ Gmail thread: any follow-up that is not the outbound RFQ template.
     * Includes short demo replies (e.g. "dfdg") when vendor email matches connected inbox.
     */
    const allowThreadFollowUp =
      args.inRfqThread &&
      vendorOk &&
      (vendorReply || isRe || (snippetTrim.length > 0 && (!isSelf || vendorEmails.size > 0)));

    if (args.inRfqThread) {
      if (!allowThreadFollowUp) return;
    } else {
      if (isSent) return;
      if (isSelf) return;
      if (!refInText) return;
      if (!vendorOk && vendorEmails.size > 0) return;
    }
    const row: VendorGmailReply = {
      messageId: args.id,
      threadId: args.threadId,
      from: args.fromHeader.trim() || addr,
      subject: args.subject.trim() || "(no subject)",
      snippet: (args.snippet ?? "").trim(),
      internalMs: args.internalMs,
      gmailUrl: gmailThreadOrMessageWebUrl(args.threadId, args.id),
      attachments: [],
    };
    const prev = byId.get(args.id);
    if (!prev || row.internalMs > prev.internalMs) byId.set(args.id, row);
  };

  for (const tr of threadRows.rows as { gmail_thread_id?: string }[]) {
    const tid = tr.gmail_thread_id?.trim();
    if (!tid) continue;
    try {
      const thr = await gmail.users.threads.get({
        userId: "me",
        id: tid,
        format: "metadata",
        metadataHeaders: ["From", "Subject"],
      });
      const threadId = thr.data.id ?? tid;
      for (const msg of thr.data.messages ?? []) {
        if (!msg.id) continue;
        const internalMs = Number(msg.internalDate ?? 0);
        const { from, subject } = readHeaders(msg.payload);
        consider({
          id: msg.id,
          threadId: threadId,
          internalMs,
          fromHeader: from,
          subject,
          snippet: msg.snippet ?? "",
          labelIds: msg.labelIds,
          inRfqThread: true,
        });
      }
    } catch {
      /* thread missing */
    }
  }

  const list = await gmail.users.messages.list({
    userId: "me",
    maxResults: 40,
    q: `newer_than:30d (in:inbox OR in:sent) -in:spam -in:trash -in:draft "${ref}"`,
  });
  for (const m of list.data.messages ?? []) {
    if (!m.id) continue;
    try {
      const full = await gmail.users.messages.get({
        userId: "me",
        id: m.id,
        format: "metadata",
        metadataHeaders: ["From", "Subject"],
      });
      const internalMs = Number(full.data.internalDate ?? 0);
      const { from, subject } = readHeaders(full.data.payload);
      consider({
        id: m.id,
        threadId: full.data.threadId ?? m.id,
        internalMs,
        fromHeader: from,
        subject,
        snippet: full.data.snippet ?? "",
        labelIds: full.data.labelIds,
        inRfqThread: false,
      });
    } catch {
      /* skip */
    }
  }

  const replies = [...byId.values()].sort((a, b) => b.internalMs - a.internalMs);
  for (const row of replies) {
    try {
      row.attachments = await attachmentsForMessage(gmail, indentId, row.messageId);
    } catch {
      row.attachments = [];
    }
  }
  return NextResponse.json({
    replies,
    connectedInbox: cred?.email ?? null,
  });
});
