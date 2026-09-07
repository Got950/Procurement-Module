import type { Role } from "@/lib/domain-types";
import { DocumentType } from "@/lib/domain-types";
import { prisma } from "@/lib/db";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { canProcurement } from "@/lib/rbac/policies";
import { readStoredFile } from "@/server/document-store";
import { buildMimeMultipartWithAttachments, getGmailClient } from "@/server/gmail-service";
import { sendPo } from "@/server/workflow/indent-workflow";

export type PurchaseOrderSendResult = {
  ok: true;
  poNumber: string;
  sentToEmail: string;
  gmailMessageId: string | null;
  attachedPdf: boolean;
};

/**
 * Sends a drafted purchase order to the selected vendor and records the state
 * transition. The single implementation used by both the PO route and the
 * Copilot action tool: authorization, vendor resolution, Gmail delivery and the
 * workflow transition stay in one place.
 */
export async function sendPurchaseOrderEmail(
  indentId: string,
  actor: { id: string; role: Role },
  poId: string
): Promise<PurchaseOrderSendResult> {
  if (!canProcurement(actor.role)) throw new AuthorizationError();
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, indentId },
    include: {
      indent: {
        include: { vendorSelection: { include: { selectedVendor: true } } },
      },
    },
  });
  if (!po) throw new NotFoundError("PO not found");
  const email = po.indent.vendorSelection?.selectedVendor?.email ?? null;
  if (!email) throw new ValidationError("Vendor email missing");

  const gmail = await getGmailClient();
  if (!gmail) throw new ValidationError(
    "Gmail not connected. Connect Gmail from the mailbox controls, then retry sending the purchase order."
  );

  const pdfDoc = await prisma.document.findFirst({
    where: { indentId, type: DocumentType.PURCHASE_ORDER },
    orderBy: { createdAt: "desc" },
  });
  let pdfBuf: Buffer | null = null;
  if (pdfDoc) {
    try {
      pdfBuf = await readStoredFile(pdfDoc.storagePath);
    } catch {
      pdfBuf = null;
    }
  }

  const bodyText = `Please find purchase order ${po.poNumber} attached as PDF.\n\nPlain-text excerpt of terms:\n${po.bodyHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500)}`;
  const mime = buildMimeMultipartWithAttachments({
    to: email,
    subject: `Purchase Order ${po.poNumber}`,
    bodyText,
    attachments: pdfBuf
      ? [{ filename: `${po.poNumber}.pdf`, mimeType: "application/pdf", content: pdfBuf }]
      : [],
  });
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: Buffer.from(mime).toString("base64url") },
  });
  const gmailMessageId = res.data.id ?? undefined;
  await sendPo(indentId, actor.id, actor.role, po.id, gmailMessageId);
  await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: { sentToEmail: email, deliveryStatus: "SENT" },
  });
  return {
    ok: true,
    poNumber: po.poNumber,
    sentToEmail: email,
    gmailMessageId: gmailMessageId ?? null,
    attachedPdf: Boolean(pdfBuf),
  };
}
