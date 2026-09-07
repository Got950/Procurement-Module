import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { withConcurrencyGate } from "@/lib/concurrency";
import { idParam } from "@/lib/schemas";
import { prisma } from "@/lib/db";
import { appendAudit } from "@/server/audit-service";
import { buildVendorPdf } from "@/server/vendor-pdf";
import { AuthorizationError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { canManageMasters } from "@/lib/rbac/policies";

/** Dynamically generates a printable vendor profile PDF from live vendor data. */
export const GET = withApiHandler({
  params: idParam,
  body: false,
})(async ({ session, params }) => {
  if (!session) throw new UnauthorizedError();
  if (!canManageMasters(session.role)) throw new AuthorizationError();
  const vendor = await prisma.vendor.findUnique({ where: { id: params.id } });
  if (!vendor) throw new NotFoundError();

  return withConcurrencyGate(
    "pdf",
    "PDF_MAX_CONCURRENT",
    2,
    async () => {
      const pdf = await buildVendorPdf(params.id);
      await appendAudit({
        entityType: "Vendor",
        entityId: pdf.vendorId,
        action: "DOWNLOAD_VENDOR_PDF",
        actorId: session.sub,
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
