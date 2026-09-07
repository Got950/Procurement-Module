import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { indentIdParam } from "@/lib/schemas";
import {
  AuthorizationError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";
import { prisma } from "@/lib/db";
import { canProcurement } from "@/lib/rbac/policies";
import { savePoDraft } from "@/server/workflow/indent-workflow";
import { DocumentType } from "@/lib/domain-types";
import { appendAudit } from "@/server/audit-service";
import { saveUploadedFile } from "@/server/document-store";

function escHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const POST = withApiHandler({
  params: indentIdParam,
  body: false,
})(async ({ req, session, params }) => {
  if (!session) throw new UnauthorizedError();
  if (!canProcurement(session.role)) throw new AuthorizationError();
  const { indentId } = params;

  const indent = await prisma.indent.findUniqueOrThrow({
    where: { id: indentId },
    include: { vendorSelection: true },
  });
  if (!indent.vendorSelection) {
    throw new ValidationError("Vendor not selected yet");
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new ValidationError("PDF file is required (field name: file)");
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0) throw new ValidationError("Empty file");
  const mime = (file.type || "").toLowerCase();
  const lowerName = (file.name || "").toLowerCase();
  if (mime !== "application/pdf" && !lowerName.endsWith(".pdf")) {
    throw new ValidationError("Only PDF files are allowed");
  }

  const poNumber = `${indent.reference}-PO`;
  const safeName = file.name.replace(/[^\w.\- ()\[\]]+/g, "_").slice(0, 180) || "purchase-order.pdf";

  const po = await savePoDraft(indentId, session.sub, session.role, {
    poNumber,
    bodyHtml: `<div style="font-family:system-ui,-apple-system,sans-serif;background:#f0f7ff;color:#0f172a;padding:18px 20px;border-radius:12px;border:1px solid #bfdbfe;line-height:1.5"><p style="margin:0"><strong style="color:#1e40af">Purchase order</strong> — PDF uploaded: ${escHtml(safeName)}</p></div>`,
    bodyJson: {
      source: "pdf_upload",
      fileName: file.name,
      bytes: buf.length,
      uploadedAt: new Date().toISOString(),
    },
  });

  const logicalKey = `purchase-order:${poNumber}`;
  const prev = await prisma.document.findFirst({
    where: { indentId, logicalKey },
    orderBy: { version: "desc" },
  });
  const version = (prev?.version ?? 0) + 1;

  const { storagePath, filename } = await saveUploadedFile(
    indentId,
    buf,
    file.name.toLowerCase().endsWith(".pdf") ? file.name : `${safeName.replace(/\.pdf$/i, "")}.pdf`
  );
  const pdfDoc = await prisma.document.create({
    data: {
      indentId,
      logicalKey,
      version,
      filename: file.name || filename,
      storagePath,
      mimeType: "application/pdf",
      type: DocumentType.PURCHASE_ORDER,
      uploadedById: session.sub,
    },
  });

  await appendAudit({
    entityType: "Document",
    entityId: pdfDoc.id,
    action: "PO_PDF_UPLOADED",
    actorId: session.sub,
    indentId,
    diff: { poNumber, logicalKey, version, filename: file.name },
  });

  return NextResponse.json({
    po,
    pdfDocument: {
      id: pdfDoc.id,
      filename: pdfDoc.filename,
      href: `/api/documents/${pdfDoc.id}/file`,
    },
  });
});
