import { DocumentType, NotificationType } from "@/lib/domain-types";
import { prisma, query } from "@/lib/db";
import { getGmailClient } from "@/server/gmail-service";
import { saveUploadedFile } from "@/server/document-store";
import { notifyUsers } from "@/server/notification-service";
import { appendAudit } from "@/server/audit-service";
import { canonicalEmailForCompare, gmailThreadOrMessageWebUrl } from "@/lib/gmail-address";
import { circuitGuard, takeToken, withRetry } from "@/lib/backoff";
import { log } from "@/lib/logger";

type GmailApi = NonNullable<Awaited<ReturnType<typeof getGmailClient>>>;

type MsgPart = {
  parts?: MsgPart[];
  body?: { attachmentId?: string | null } | null;
  filename?: string | null;
  mimeType?: string | null;
};

function walkParts(p: MsgPart | undefined): MsgPart[] {
  if (!p) return [];
  const out: MsgPart[] = [];
  if (p.parts) for (const c of p.parts) out.push(...walkParts(c));
  if (p.body?.attachmentId && p.filename) out.push(p);
  return out;
}

const GMAIL_NEG = "-in:spam -in:trash -in:draft";

function isUniqueViolation(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

async function gmailCall<T>(fn: () => Promise<T>): Promise<T> {
  const breaker = circuitGuard("gmail");
  if (!takeToken("gmail")) {
    await new Promise((r) => setTimeout(r, 250));
  }
  try {
    const out = await withRetry(fn, { attempts: 3 });
    breaker.ok();
    return out;
  } catch (e) {
    breaker.fail();
    throw e;
  }
}

async function markMessageIngested(gmailMessageId: string, indentId: string | null) {
  try {
    await prisma.gmailIngestedMessage.create({
      data: { gmailMessageId, indentId },
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
}

async function indentIdForGmailThread(threadId: string): Promise<string | null> {
  const r = await query<{ indent_id: string }>(
    `SELECT indent_id FROM rfqs
     WHERE gmail_thread_id = $1
     ORDER BY sent_at DESC NULLS LAST
     LIMIT 1`,
    [threadId]
  );
  if (r.rows[0]?.indent_id) return r.rows[0].indent_id;
  const r2 = await query<{ indent_id: string }>(
    `SELECT r.indent_id
     FROM rfq_vendors rv
     INNER JOIN rfqs r ON r.id = rv.rfq_id
     WHERE rv.gmail_thread_id = $1
     ORDER BY r.sent_at DESC NULLS LAST
     LIMIT 1`,
    [threadId]
  );
  return r2.rows[0]?.indent_id ?? null;
}

async function collectInboxMessageIdsFull(gmail: GmailApi) {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const r1 = await gmailCall(() =>
      gmail.users.messages.list({
        userId: "me",
        maxResults: 100,
        pageToken,
        q: `newer_than:120d ${GMAIL_NEG} subject:IND-`,
      })
    );
    for (const m of r1.data.messages ?? []) {
      if (m.id) ids.add(m.id);
    }
    pageToken = r1.data.nextPageToken ?? undefined;
    pages += 1;
  } while (pageToken && pages < 20);

  const threadsRes = await query<{ gmail_thread_id: string }>(
    `SELECT DISTINCT gmail_thread_id FROM (
       SELECT gmail_thread_id FROM rfqs
       WHERE gmail_thread_id IS NOT NULL
         AND sent_at IS NOT NULL
         AND sent_at > NOW() - INTERVAL '180 days'
       UNION
       SELECT rv.gmail_thread_id FROM rfq_vendors rv
       INNER JOIN rfqs r ON r.id = rv.rfq_id
       WHERE rv.gmail_thread_id IS NOT NULL
         AND r.sent_at IS NOT NULL
         AND r.sent_at > NOW() - INTERVAL '180 days'
     ) t
     WHERE gmail_thread_id IS NOT NULL
     LIMIT 50`
  );
  for (const row of threadsRes.rows) {
    const tid = row.gmail_thread_id?.trim();
    if (!tid) continue;
    try {
      const thr = await gmailCall(() =>
        gmail.users.threads.get({ userId: "me", id: tid, format: "minimal" })
      );
      for (const m of thr.data.messages ?? []) {
        if (m?.id) ids.add(m.id);
      }
    } catch {
      /* deleted thread */
    }
  }
  return [...ids];
}

function historyExpired(e: unknown) {
  const status = (e as { code?: number; response?: { status?: number } }).code
    ?? (e as { response?: { status?: number } }).response?.status;
  return status === 404 || String((e as Error).message ?? e).includes("notFound");
}

async function collectIncrementalIds(gmail: GmailApi, startHistoryId: string): Promise<string[] | "expired"> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;
  try {
    do {
      const res = await gmailCall(() =>
        gmail.users.history.list({
          userId: "me",
          startHistoryId,
          pageToken,
          historyTypes: ["messageAdded"],
        })
      );
      for (const h of res.data.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          if (added.message?.id) ids.add(added.message.id);
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
      pages += 1;
    } while (pageToken && pages < 20);
  } catch (e) {
    if (historyExpired(e)) return "expired";
    throw e;
  }
  return [...ids];
}

async function persistGmailMessage(row: {
  gmailMessageId: string;
  threadId: string | null;
  indentId: string | null;
  fromEmail: string;
  subject: string;
  snippet: string;
  internalMs: number;
  attachments: unknown;
}) {
  await query(
    `INSERT INTO gmail_messages
       (gmail_message_id, thread_id, indent_id, from_email, subject, snippet, internal_ms, attachments_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (gmail_message_id) DO UPDATE SET
       thread_id = EXCLUDED.thread_id,
       indent_id = COALESCE(EXCLUDED.indent_id, gmail_messages.indent_id),
       from_email = EXCLUDED.from_email,
       subject = EXCLUDED.subject,
       snippet = EXCLUDED.snippet,
       internal_ms = EXCLUDED.internal_ms,
       attachments_json = EXCLUDED.attachments_json`,
    [
      row.gmailMessageId,
      row.threadId,
      row.indentId,
      row.fromEmail,
      row.subject,
      row.snippet,
      row.internalMs,
      JSON.stringify(row.attachments),
    ]
  );
}

export async function runGmailSync(actorId: string) {
  const gmail = await getGmailClient();
  if (!gmail) throw new Error("Gmail not connected");

  const cred = await prisma.gmailCredential.findFirst();
  const inboxEmail = (cred?.email ?? "").trim().toLowerCase();
  const inboxCanon = inboxEmail ? canonicalEmailForCompare(inboxEmail) : "";

  const procUsers = await prisma.user.findMany({
    where: { isActive: true, role: { in: ["PROCUREMENT", "ADMIN"] } },
    select: { id: true },
  });
  const notifyUserIds = procUsers.map((u: { id: string }) => u.id);

  const state = await query<{ last_history_id: string | null }>(
    `SELECT last_history_id FROM gmail_sync_state WHERE id = 'default'`
  );
  const lastHistory = state.rows[0]?.last_history_id ?? null;
  let mode: "incremental" | "full" = "full";
  let ids: string[] = [];

  if (lastHistory) {
    const incremental = await collectIncrementalIds(gmail, lastHistory);
    if (incremental === "expired") {
      log.warn("gmail history expired; falling back to full sync");
      ids = await collectInboxMessageIdsFull(gmail);
    } else {
      mode = "incremental";
      ids = incremental;
    }
  } else {
    ids = await collectInboxMessageIdsFull(gmail);
  }

  const profile = await gmailCall(() => gmail.users.getProfile({ userId: "me" }));
  const newHistoryId = profile.data.historyId ? String(profile.data.historyId) : lastHistory;

  let quotationsCreated = 0;
  let vendorMailAlerts = 0;
  const maxVendorMailAlertsPerSync = 25;

  for (const mid of ids) {
    const seen = await prisma.gmailIngestedMessage.findUnique({ where: { gmailMessageId: mid } });
    if (seen) continue;

    let indentIdForMark: string | null = null;
    try {
      const full = await gmailCall(() => gmail.users.messages.get({ userId: "me", id: mid, format: "full" }));
      const headers = full.data.payload?.headers ?? [];
      const subj = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "";
      const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
      const addrMatch = from.match(/<([^>]+)>/);
      const rawAddr = (addrMatch?.[1] ?? from).trim();
      const addr = rawAddr.toLowerCase();
      const refMatch = subj.match(/IND-\d{4}-\d+/);
      const subjectRef = refMatch?.[0] ?? null;
      let indent = refMatch
        ? await prisma.indent.findFirst({ where: { reference: refMatch[0] } })
        : null;

      const threadId = full.data.threadId ?? null;
      if (!indent && threadId) {
        const indentId = await indentIdForGmailThread(threadId);
        if (indentId) indent = await prisma.indent.findUnique({ where: { id: indentId } });
      }

      const vendor = addr
        ? (
            await query<{ id: string; company_name: string }>(
              `SELECT id, company_name FROM vendors WHERE lower(trim(email)) = $1 LIMIT 1`,
              [addr.trim().toLowerCase()]
            )
          ).rows[0] ?? null
        : null;

      const gmailUrl = gmailThreadOrMessageWebUrl(threadId, mid);
      const attMeta: { filename: string; mimeType: string; attachmentId: string }[] = [];

      if (indent) {
        indentIdForMark = indent.id;
        const parts = walkParts(full.data.payload as MsgPart);
        for (const p of parts) {
          if (!p.mimeType?.includes("pdf") || !p.body?.attachmentId || !p.filename) continue;
          attMeta.push({
            filename: p.filename,
            mimeType: p.mimeType,
            attachmentId: p.body.attachmentId,
          });
          const logicalKey = `gmail-${mid}-${p.filename}`;
          const existingDoc = await prisma.document.findFirst({
            where: { indentId: indent.id, logicalKey },
          });
          if (existingDoc) continue;

          const att = await gmailCall(() =>
            gmail.users.messages.attachments.get({
              userId: "me",
              messageId: mid,
              id: p.body!.attachmentId!,
            })
          );
          const raw = att.data.data;
          if (!raw) continue;
          const buf = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
          const { storagePath, filename, hash, size } = await saveUploadedFile(
            indent.id,
            buf,
            p.filename.toLowerCase().endsWith(".pdf") ? p.filename : `${p.filename}.pdf`
          );
          const doc = await prisma.document.create({
            data: {
              indentId: indent.id,
              logicalKey,
              version: 1,
              filename,
              storagePath,
              mimeType: "application/pdf",
              type: DocumentType.QUOTATION,
              uploadedById: actorId,
              contentHash: hash,
              sizeBytes: size,
              processingStatus: "READY",
              storageBackend: storagePath.startsWith("s3://") ? "s3" : "fs",
            },
          });
          const vid = vendor?.id;
          if (vid) {
            const existingQ = await prisma.quotation.findFirst({
              where: { indentId: indent.id, vendorId: vid, documentId: doc.id },
            });
            if (!existingQ) {
              await prisma.quotation.create({
                data: { indentId: indent.id, vendorId: vid, documentId: doc.id },
              });
              quotationsCreated++;
            }
          } else {
            await appendAudit({
              entityType: "Document",
              entityId: doc.id,
              action: "UNMATCHED_GMAIL_VENDOR",
              actorId,
              indentId: indent.id,
              diff: { from: addr },
            });
          }
        }
      }

      const internalMs = full.data.internalDate ? Number(full.data.internalDate) : Date.now();
      await persistGmailMessage({
        gmailMessageId: mid,
        threadId,
        indentId: indent?.id ?? indentIdForMark,
        fromEmail: addr,
        subject: subj,
        snippet: full.data.snippet ?? "",
        internalMs,
        attachments: attMeta,
      });

      const addrCanon = addr ? canonicalEmailForCompare(addr) : "";
      const fromSelf = inboxCanon.length > 0 && addrCanon.length > 0 && addrCanon === inboxCanon;
      const effectiveRef = subjectRef ?? indent?.reference ?? null;
      const relevant = Boolean(indent || subjectRef);
      const ageMs = Date.now() - internalMs;
      const isRecent = ageMs >= -120_000 && ageMs <= 35 * 86400000;
      if (
        relevant &&
        !fromSelf &&
        isRecent &&
        notifyUserIds.length > 0 &&
        vendorMailAlerts < maxVendorMailAlertsPerSync
      ) {
        const vendorLabel = vendor?.company_name ?? (addr || "Unknown sender");
        const indentLabel = indent?.reference ?? effectiveRef ?? "no indent ref in subject";
        await notifyUsers(notifyUserIds, {
          type: NotificationType.VENDOR_GMAIL,
          title: `Vendor mail: ${vendorLabel}`,
          body: `${subj || "(no subject)"} � Case ${indentLabel}. Open in Gmail to read in your mailbox.`,
          indentId: indent?.id ?? null,
          actionUrl: gmailUrl,
        });
        vendorMailAlerts += 1;
      }

      await markMessageIngested(mid, indent?.id ?? indentIdForMark);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      await markMessageIngested(mid, indentIdForMark);
    }
  }

  await query(
    `INSERT INTO gmail_sync_state (id, mailbox_email, last_history_id, last_full_sync_at, updated_at)
     VALUES ('default', $1, $2, CASE WHEN $3 = 'full' THEN NOW() ELSE NULL END, NOW())
     ON CONFLICT (id) DO UPDATE SET
       mailbox_email = EXCLUDED.mailbox_email,
       last_history_id = EXCLUDED.last_history_id,
       last_full_sync_at = CASE WHEN $3 = 'full' THEN NOW() ELSE gmail_sync_state.last_full_sync_at END,
       updated_at = NOW()`,
    [inboxEmail || null, newHistoryId, mode]
  );

  return { scanned: ids.length, quotationsCreated, vendorMailAlerts, mode };
}

export async function listStoredReplies(indentId: string) {
  const r = await query<{
    gmail_message_id: string;
    thread_id: string | null;
    from_email: string | null;
    subject: string | null;
    snippet: string | null;
    internal_ms: string | number | null;
    attachments_json: unknown;
  }>(
    `SELECT gmail_message_id, thread_id, from_email, subject, snippet, internal_ms, attachments_json
       FROM gmail_messages
      WHERE indent_id = $1
      ORDER BY internal_ms DESC NULLS LAST
      LIMIT 100`,
    [indentId]
  );
  return r.rows.map((row) => ({
    messageId: row.gmail_message_id,
    threadId: row.thread_id ?? "",
    from: row.from_email ?? "",
    subject: row.subject ?? "(no subject)",
    snippet: row.snippet ?? "",
    internalMs: Number(row.internal_ms ?? 0),
    attachments: Array.isArray(row.attachments_json) ? row.attachments_json : [],
  }));
}
