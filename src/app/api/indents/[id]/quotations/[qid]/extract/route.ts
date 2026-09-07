import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { AuthorizationError, UnauthorizedError, ValidationError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { canProcurement } from "@/lib/rbac/policies";
import { readQuotationDocumentText } from "@/server/quotation-document-text";
import { extractQuotationFromText } from "@/server/openai/quotation-ai";

const extractParams = z.object({
  id: z.string().min(1).max(64),
  qid: z.string().min(1).max(64),
});

export const POST = withApiHandler({
  params: extractParams,
  body: false,
})(async ({ session, params }) => {
  if (!session) throw new UnauthorizedError();
  if (!canProcurement(session.role)) throw new AuthorizationError();
  const q = await prisma.quotation.findFirst({
    where: { id: params.qid, indentId: params.id },
    include: { vendor: true, document: true, indent: { include: { item: true } } },
  });
  if (!q || !q.document) throw new NotFoundError("Quotation or document missing");
  const text = await readQuotationDocumentText(q.document.storagePath, q.document.mimeType);
  if (!text.trim()) throw new ValidationError("No extractable text");
  const extracted = await extractQuotationFromText(text, q.indent.item, q.vendor);
  const updated = await prisma.quotation.update({
    where: { id: q.id },
    data: {
      rawExtractionJson: extracted as object,
      unitPrice: extracted.unitPrice != null ? Number(extracted.unitPrice as number) : undefined,
      leadTimeDays:
        extracted.leadTimeDays != null ? Number(extracted.leadTimeDays as number) : undefined,
      paymentTerms: (extracted.paymentTerms as string) ?? undefined,
      certifications: extracted.certifications as object,
      deviations: extracted.deviations as object,
      summaryText: (extracted.summary as string) ?? undefined,
    },
  });
  return NextResponse.json({ quotation: updated, extracted });
});
