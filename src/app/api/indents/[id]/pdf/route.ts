import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { withConcurrencyGate } from "@/lib/concurrency";
import { idParam } from "@/lib/schemas";
import { prisma } from "@/lib/db";
import { canViewIndent } from "@/lib/indent-access";
import { appendAudit } from "@/server/audit-service";
import { buildIndentPdf } from "@/server/indent-pdf";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";

/** Dynamically generates a printable indent PDF from live indent data. */
export const GET = withApiHandler({
  auth: false,
  params: idParam,
  body: false,
})(async ({ session, params }) => {
  if (!session) throw new UnauthorizedError();
  const indent = await prisma.indent.findUnique({ where: { id: params.id } });
  if (!indent || !canViewIndent(session, indent)) throw new NotFoundError();

  return withConcurrencyGate(
    "pdf",
    "PDF_MAX_CONCURRENT",
    2,
    async () => {
      const pdf = await buildIndentPdf(params.id);
      await appendAudit({
        entityType: "Indent",
        entityId: pdf.indentId,
        action: "DOWNLOAD_INDENT_PDF",
        actorId: session.sub,
        indentId: pdf.indentId,
        diff: { filename: pdf.filename },
      });

      return new NextResponse(Buffer.from(pdf.bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdf.filename}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    },
    "PDF generation is busy. Please retry shortly."
  );
});
