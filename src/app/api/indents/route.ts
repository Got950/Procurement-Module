import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/db";
import { canCreateIndent } from "@/lib/rbac/policies";
import { indentListWhere } from "@/lib/indent-access";
import { createDraftIndent } from "@/server/indent-create";
import { AuthorizationError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { INDENT_PAGE_SIZE } from "@/components/app/pagination-controls";
import { redactIndentBankFields } from "@/lib/api-sanitize";

const createIndentBody = z.object({
  itemId: z.string().min(1),
  // Cap below Postgres NUMERIC(12,4) overflow (~1e8) with headroom for business use.
  quantity: z.number().positive().max(1_000_000),
  priority: z.string().optional(),
  justification: z.string().min(1),
  estimatedAmount: z.number().finite().nonnegative().max(1_000_000_000_000).optional(),
});

export const GET = withApiHandler({ body: false })(async ({ session, req }) => {
  if (!session) throw new UnauthorizedError();
  const url = new URL(req.url);
  const pageRaw = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const limitRaw = Number.parseInt(
    url.searchParams.get("limit") ?? String(INDENT_PAGE_SIZE),
    10
  );
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 10_000) : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(100, Math.max(1, limitRaw))
      : INDENT_PAGE_SIZE;
  const where = indentListWhere(session.role, session.sub);
  const total = await prisma.indent.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const indents = await prisma.indent.findMany({
    where,
    include: {
      item: true,
      requester: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
    skip: (safePage - 1) * limit,
  });
  return NextResponse.json({
    indents: indents.map((indent) =>
      redactIndentBankFields(indent as Record<string, unknown>, session.role)
    ),
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
    },
  });
});

export const POST = withApiHandler({ body: createIndentBody })(async ({ session, body }) => {
  if (!session) throw new UnauthorizedError();
  if (!canCreateIndent(session.role)) throw new AuthorizationError();
  if (!body.itemId || !body.quantity || !body.justification) {
    throw new ValidationError("Missing fields");
  }
  const indent = await createDraftIndent(session.sub, body);
  return NextResponse.json({ indent });
});
