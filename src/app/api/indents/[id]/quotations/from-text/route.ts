import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { AuthorizationError, UnauthorizedError, ValidationError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { canProcurement } from "@/lib/rbac/policies";
import { appendAudit } from "@/server/audit-service";
import { publicDocument } from "@/lib/api-sanitize";

const textQuoteBody = z.object({
  vendorId: z.string().min(1),
  text: z.string().min(1),
});

/** Create or update a quotation using pasted text only (no PDF). */
export const POST = withApiHandler({
  params: idParam,
  body: textQuoteBody,
})(async ({ session, params, body }) => {
  if (!session) throw new UnauthorizedError();
  if (!canProcurement(session.role)) throw new AuthorizationError();
  const indentId = params.id;
  const vendorId = body.vendorId.trim();
  const text = body.text.trim();
  if (!vendorId || !text) {
    throw new ValidationError("vendorId and non-empty text required");
  }
  const clipped = text.slice(0, 50_000);

  const existing = await prisma.quotation.findFirst({
    where: { indentId, vendorId },
    orderBy: { createdAt: "desc" },
  });

  const patch = { userPastedQuote: clipped };
  if (existing) {
    const prev = (existing.rawExtractionJson as Record<string, unknown> | null) ?? {};
    const q = await prisma.quotation.update({
      where: { id: existing.id },
      data: { rawExtractionJson: { ...prev, ...patch } as object },
      include: { vendor: true, document: true },
    });
    if (!q) throw new NotFoundError();
    await appendAudit({
      entityType: "Quotation",
      entityId: q.id,
      action: "TEXT_QUOTE_SAVE",
      actorId: session.sub,
      indentId,
      diff: { vendorId },
    });
    return NextResponse.json({
      quotation: {
        ...q,
        document: q.document
          ? publicDocument(q.document as Record<string, unknown>)
          : q.document,
      },
    });
  }

  const q = await prisma.quotation.create({
    data: {
      indentId,
      vendorId,
      documentId: null,
      rawExtractionJson: patch as object,
    },
    include: { vendor: true, document: true },
  });
  await appendAudit({
    entityType: "Quotation",
    entityId: q.id,
    action: "TEXT_QUOTE_CREATE",
    actorId: session.sub,
    indentId,
    diff: { vendorId },
  });
  return NextResponse.json({
    quotation: {
      ...q,
      document: q.document
        ? publicDocument(q.document as Record<string, unknown>)
        : q.document,
    },
  });
});
