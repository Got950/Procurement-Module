import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { prisma } from "@/lib/db";
import { canViewIndent } from "@/lib/indent-access";
import { contentDispositionAttachment, readStoredFile } from "@/server/document-store";
import { appendAudit } from "@/server/audit-service";
import { buildIndentPdf, isDemoIndentAttachment } from "@/server/indent-pdf";

/** Empty status bodies preserved for download clients (not JSON errors). */
export const GET = withApiHandler({
  auth: false,
  params: idParam,
  body: false,
})(async ({ session, params }) => {
  if (!session) return new NextResponse(null, { status: 401 });
  const doc = await prisma.document.findUnique({ where: { id: params.id } });
  if (!doc) return new NextResponse(null, { status: 404 });
  const indent = await prisma.indent.findUnique({ where: { id: doc.indentId } });
  if (!indent || !canViewIndent(session, indent)) {
    return new NextResponse(null, { status: 404 });
  }

  // Demo indent placeholders are not real files — generate the live indent PDF instead.
  if (isDemoIndentAttachment(doc)) {
    const pdf = await buildIndentPdf(String(doc.indentId));
    await appendAudit({
      entityType: "Document",
      entityId: doc.id,
      action: "DOWNLOAD",
      actorId: session.sub,
      indentId: doc.indentId,
      diff: { filename: pdf.filename, generated: true },
    });
    return new NextResponse(Buffer.from(pdf.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDispositionAttachment(pdf.filename),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }

  let buf: Buffer;
  try {
    buf = await readStoredFile(doc.storagePath);
  } catch {
    return NextResponse.json(
      {
        error: "Document file is missing on the server",
        errorDetail: {
          code: "DOCUMENT_FILE_MISSING",
          message: "The document record exists, but the stored file could not be read.",
        },
      },
      { status: 404 }
    );
  }
  await appendAudit({
    entityType: "Document",
    entityId: doc.id,
    action: "DOWNLOAD",
    actorId: session.sub,
    indentId: doc.indentId,
    diff: { filename: doc.filename },
  });
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": doc.mimeType || "application/octet-stream",
      "Content-Disposition": contentDispositionAttachment(String(doc.filename || "download.pdf")),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});
