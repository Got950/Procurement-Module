import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { prisma, query } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 44;
const MARGIN_TOP = 42;
const MARGIN_BOTTOM = 52;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const FG = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.47, 0.55);
const ACCENT = rgb(0.15, 0.39, 0.92);
const LINE = rgb(0.86, 0.89, 0.93);
const HEADER_BG = rgb(0.96, 0.97, 0.98);

type PdfCtx = {
  doc: PDFDocument;
  page: PDFPage;
  pages: PDFPage[];
  font: PDFFont;
  fontBold: PDFFont;
  y: number;
};

function text(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function pdfSafe(value: string): string {
  return value
    .replace(/₹/g, "INR ")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function wrapLines(font: PDFFont, value: string, size: number, maxWidth: number): string[] {
  const raw = pdfSafe(text(value));
  if (!raw) return [];
  const words = raw.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function rightAlign(font: PDFFont, value: string, size: number, rightX: number) {
  return rightX - font.widthOfTextAtSize(pdfSafe(value), size);
}

function drawFooter(ctx: PdfCtx, page: PDFPage, pageNo: number, totalPages: number) {
  page.drawLine({
    start: { x: MARGIN_X, y: MARGIN_BOTTOM - 10 },
    end: { x: PAGE_WIDTH - MARGIN_X, y: MARGIN_BOTTOM - 10 },
    thickness: 0.6,
    color: LINE,
  });
  page.drawText("MedFlow", {
    x: MARGIN_X,
    y: 28,
    size: 8,
    font: ctx.fontBold,
    color: ACCENT,
  });
  page.drawText("Vendor master record", {
    x: MARGIN_X + 68,
    y: 28,
    size: 8,
    font: ctx.font,
    color: MUTED,
  });
  const pageLabel = `Page ${pageNo} of ${totalPages}`;
  page.drawText(pageLabel, {
    x: rightAlign(ctx.font, pageLabel, 8, PAGE_WIDTH - MARGIN_X),
    y: 28,
    size: 8,
    font: ctx.font,
    color: MUTED,
  });
}

function ensureSpace(ctx: PdfCtx, needed: number) {
  if (ctx.y - needed >= MARGIN_BOTTOM + 8) return;
  const page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.pages.push(page);
  ctx.page = page;
  ctx.y = PAGE_HEIGHT - MARGIN_TOP;
}

function drawKv(ctx: PdfCtx, label: string, value: string) {
  if (!value) return;
  ensureSpace(ctx, 28);
  ctx.page.drawText(pdfSafe(label), {
    x: MARGIN_X,
    y: ctx.y,
    size: 8,
    font: ctx.font,
    color: MUTED,
  });
  const lines = wrapLines(ctx.font, value, 10, CONTENT_WIDTH);
  ctx.y -= 14;
  for (const line of lines) {
    ensureSpace(ctx, 14);
    ctx.page.drawText(line, {
      x: MARGIN_X,
      y: ctx.y,
      size: 10,
      font: ctx.font,
      color: FG,
    });
    ctx.y -= 14;
  }
  ctx.y -= 6;
}

function drawSection(ctx: PdfCtx, title: string) {
  ensureSpace(ctx, 36);
  ctx.y -= 8;
  ctx.page.drawText(pdfSafe(title), {
    x: MARGIN_X,
    y: ctx.y,
    size: 11,
    font: ctx.fontBold,
    color: FG,
  });
  ctx.y -= 8;
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.y },
    thickness: 0.7,
    color: LINE,
  });
  ctx.y -= 18;
}

/**
 * Builds a printable vendor master PDF from live vendor data only.
 * Does not invent fields; empty optional fields are omitted.
 */
export async function buildVendorPdf(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
  });
  if (!vendor) throw new NotFoundError("Vendor not found");

  const mapped = await query<{
    name: string;
    sku: string;
    category: string;
    uom: string;
  }>(
    `SELECT i.name, i.sku, i.category, i.uom
       FROM vendor_items vi
       INNER JOIN items i ON i.id = vi.item_id
      WHERE vi.vendor_id = $1
      ORDER BY i.name ASC
      LIMIT 100`,
    [vendorId]
  );

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const ctx: PdfCtx = { doc, page, pages: [page], font, fontBold, y: PAGE_HEIGHT - MARGIN_TOP };

  ctx.page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 4,
    width: PAGE_WIDTH,
    height: 4,
    color: ACCENT,
  });
  ctx.page.drawRectangle({
    x: MARGIN_X,
    y: ctx.y - 46,
    width: CONTENT_WIDTH,
    height: 52,
    color: HEADER_BG,
  });
  ctx.page.drawText("MedFlow", {
    x: MARGIN_X + 12,
    y: ctx.y - 18,
    size: 9,
    font: fontBold,
    color: ACCENT,
  });
  ctx.page.drawText("Vendor profile", {
    x: MARGIN_X + 12,
    y: ctx.y - 34,
    size: 14,
    font: fontBold,
    color: FG,
  });
  ctx.y -= 70;

  drawSection(ctx, "Company");
  drawKv(ctx, "Company name", text(vendor.companyName));
  drawKv(ctx, "Status", text(vendor.status));
  drawKv(ctx, "City", text(vendor.city));
  drawKv(ctx, "GST number", text(vendor.gstNumber));
  drawKv(ctx, "License / compliance", text(vendor.licenseInfo));

  drawSection(ctx, "Contact");
  drawKv(ctx, "Contact person", text(vendor.contactPerson));
  drawKv(ctx, "Email", text(vendor.email));
  drawKv(ctx, "Phone", text(vendor.phone));

  drawSection(ctx, "Commercial");
  drawKv(ctx, "Payment terms", text(vendor.paymentTerms));
  drawKv(ctx, "Average delivery (days)", String(vendor.averageDeliveryDays ?? ""));
  drawKv(ctx, "Rating", String(vendor.rating ?? ""));

  if (mapped.rows.length) {
    drawSection(ctx, "Mapped items");
    for (const item of mapped.rows) {
      const line = [text(item.name), item.sku ? `SKU ${item.sku}` : "", item.category, item.uom]
        .filter(Boolean)
        .join(" · ");
      drawKv(ctx, "Item", line);
    }
  }

  const totalPages = ctx.pages.length;
  ctx.pages.forEach((p, idx) => drawFooter(ctx, p, idx + 1, totalPages));

  const bytes = await doc.save();
  const safeName = pdfSafe(text(vendor.companyName) || "Vendor")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const filename = `MedFlow-${safeName || "Vendor"}-Profile.pdf`;
  return {
    bytes,
    filename,
    vendorId: String(vendor.id),
    companyName: String(vendor.companyName),
  };
}
