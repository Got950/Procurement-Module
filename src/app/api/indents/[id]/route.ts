import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { IndentStatus } from "@/lib/domain-types";
import { prisma } from "@/lib/db";
import { canViewIndent } from "@/lib/indent-access";
import { updateDraftIndent } from "@/server/indent-create";
import {
  AuthorizationError,
  UnauthorizedError,
  ValidationError,
  NotFoundError,
  ConflictError,
} from "@/lib/errors";
import { publicDocument, publicDocuments, redactIndentBankFields } from "@/lib/api-sanitize";

const patchIndentBody = z.object({
  version: z.number().int(),
  itemId: z.string().optional(),
  quantity: z.number().positive().max(1_000_000).optional(),
  priority: z.string().optional(),
  justification: z.string().optional(),
  estimatedAmount: z.number().finite().nonnegative().max(1_000_000_000_000).optional(),
});

export const GET = withApiHandler({
  params: idParam,
  body: false,
})(async ({ session, params }) => {
  if (!session) throw new UnauthorizedError();
  const indent = await prisma.indent.findUnique({
    where: { id: params.id },
    include: {
      item: true,
      requester: { select: { id: true, name: true, email: true, role: true } },
      stateHistory: { orderBy: { createdAt: "asc" } },
      approvalEvents: {
        include: { actor: { select: { name: true, role: true } } },
        orderBy: { createdAt: "asc" },
      },
      documents: { orderBy: { createdAt: "desc" } },
      rfqs: { orderBy: { sentAt: "desc" }, include: { vendors: { include: { vendor: true } } } },
      quotations: { include: { vendor: true, document: true } },
      vendorSelection: {
        include: { selectedVendor: true, aiRecommendedVendor: true },
      },
      purchaseOrders: true,
      invoices: true,
      payments: true,
      aiRuns: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  });
  if (!indent || !canViewIndent(session, indent)) throw new NotFoundError();
  const sanitized = redactIndentBankFields(
    {
      ...indent,
      documents: publicDocuments(indent.documents as Record<string, unknown>[]),
      quotations: (indent.quotations ?? []).map((q) => ({
        ...q,
        document: q.document
          ? publicDocument(q.document as Record<string, unknown>)
          : q.document,
      })),
    } as Record<string, unknown>,
    session.role
  );
  return NextResponse.json({ indent: sanitized });
});

export const PATCH = withApiHandler({
  params: idParam,
  body: patchIndentBody,
})(async ({ session, params, body }) => {
  if (!session) throw new UnauthorizedError();
  const indent = await prisma.indent.findUnique({ where: { id: params.id } });
  if (!indent) throw new NotFoundError();
  if (indent.requesterId !== session.sub && session.role !== "ADMIN") {
    throw new AuthorizationError();
  }
  if (indent.currentStatus !== IndentStatus.DRAFT) {
    throw new ValidationError("Only drafts editable");
  }
  const version = body.version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new ValidationError("version is required; send the version returned by GET");
  }
  const updated = await updateDraftIndent(session.sub, params.id, version, {
    itemId: body.itemId,
    quantity: body.quantity,
    priority: body.priority,
    justification: body.justification,
    estimatedAmount: body.estimatedAmount,
  });
  if (!updated) {
    throw new ConflictError("This indent changed since you loaded it. Refresh and retry.");
  }
  return NextResponse.json({ indent: updated });
});
