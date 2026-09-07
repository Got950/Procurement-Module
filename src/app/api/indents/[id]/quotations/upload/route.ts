import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { DocumentType } from "@/lib/domain-types";
import { AuthorizationError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { canProcurement } from "@/lib/rbac/policies";
import { saveUploadedFile } from "@/server/document-store";
import { appendAudit } from "@/server/audit-service";
import { publicDocument } from "@/lib/api-sanitize";

export const POST = withApiHandler({
  params: idParam,
  body: false,
})(async ({ req, session, params }) => {
  if (!session) throw new UnauthorizedError();
  if (!canProcurement(session.role)) throw new AuthorizationError();
  const indentId = params.id;
  const form = await req.formData();
  const file = form.get("file");
  const vendorId = form.get("vendorId") as string;
  if (!(file instanceof File) || !vendorId) {
    throw new ValidationError("file and vendorId required");
  }
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    throw new ValidationError(
      "Only PDF quote files are allowed here. Use Paste text quotation for text."
    );
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const { storagePath, filename } = await saveUploadedFile(indentId, buf, file.name);
  const logicalKey = `quote-${vendorId}-${Date.now()}`;
  const doc = await prisma.document.create({
    data: {
      indentId,
      logicalKey,
      version: 1,
      filename,
      storagePath,
      mimeType: "application/pdf",
      type: DocumentType.QUOTATION,
      uploadedById: session.sub,
    },
  });
  const q = await prisma.quotation.create({
    data: {
      indentId,
      vendorId,
      documentId: doc.id,
    },
  });
  await appendAudit({
    entityType: "Quotation",
    entityId: q.id,
    action: "UPLOAD",
    actorId: session.sub,
    indentId,
    diff: { documentId: doc.id },
  });
  return NextResponse.json({
    quotation: q,
    document: publicDocument(doc as Record<string, unknown>),
  });
});
