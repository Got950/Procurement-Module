import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { UnauthorizedError } from "@/lib/errors";
import { recordInvoice } from "@/server/workflow/indent-workflow";

const invoiceBody = z.object({
  vendorName: z.string().min(1),
  amount: z.number().optional(),
  purchaseOrderId: z.string().optional(),
  documentId: z.string().optional(),
  kind: z.enum(["PROFORMA", "FINAL"]).optional(),
});

export const POST = withApiHandler({
  params: idParam,
  body: invoiceBody,
})(async ({ session, params, body }) => {
  if (!session) throw new UnauthorizedError();
  await recordInvoice(params.id, session.sub, session.role, {
    vendorName: body.vendorName,
    amount: body.amount,
    purchaseOrderId: body.purchaseOrderId,
    documentId: body.documentId,
    kind: body.kind,
  });
  return NextResponse.json({ ok: true });
});
