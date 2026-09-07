import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { DocumentType } from "@/lib/domain-types";
import {
  AuthorizationError,
  UnauthorizedError,
  ValidationError,
  NotFoundError,
} from "@/lib/errors";
import { prisma } from "@/lib/db";
import { canViewIndent } from "@/lib/indent-access";
import { canUploadDocument } from "@/lib/rbac/policies";
import { isUuid, saveUploadedFile } from "@/server/document-store";
import { appendAudit } from "@/server/audit-service";
import { publicDocument } from "@/lib/api-sanitize";

const DOCUMENT_TYPES = new Set<string>(Object.values(DocumentType));

export const POST = withApiHandler({ body: false })(async ({ req, session }) => {
  if (!session) throw new UnauthorizedError();
  const form = await req.formData();
  const file = form.get("file");
  const indentId = String(form.get("indentId") ?? "");
  const typeRaw = String(form.get("type") ?? DocumentType.OTHER);
  if (!(file instanceof File) || !indentId) {
    throw new ValidationError("file and indentId required");
  }
  if (!isUuid(indentId)) throw new ValidationError("Invalid indent id");
  if (!DOCUMENT_TYPES.has(typeRaw)) throw new ValidationError("Invalid document type");
  const type = typeRaw as DocumentType;
  const indent = await prisma.indent.findUnique({ where: { id: indentId } });
  if (!indent || !canViewIndent(session, indent)) throw new NotFoundError();
  if (!canUploadDocument(session.role, indent, type, session.sub)) {
    throw new AuthorizationError();
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const { storagePath, filename, hash, size } = await saveUploadedFile(indentId, buf, file.name);
  const requestedKey = String(form.get("logicalKey") ?? "");
  const logicalKey = /^[a-zA-Z0-9._-]{1,120}$/.test(requestedKey)
    ? requestedKey
    : `doc-${crypto.randomUUID()}`;
  const prev = await prisma.document.findFirst({
    where: { indentId, logicalKey },
    orderBy: { version: "desc" },
  });
  const doc = await prisma.document.create({
    data: {
      indentId,
      logicalKey,
      version: (prev?.version ?? 0) + 1,
      filename,
      storagePath,
      mimeType: "application/pdf",
      type,
      uploadedById: session.sub,
      contentHash: hash,
      sizeBytes: size,
      processingStatus: "READY",
    },
  });
  await appendAudit({
    entityType: "Document",
    entityId: doc.id,
    action: "UPLOAD",
    actorId: session.sub,
    indentId,
    diff: { type },
  });
  return NextResponse.json({ document: publicDocument(doc as Record<string, unknown>) });
});
