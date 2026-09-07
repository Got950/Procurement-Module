import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 44;
const MARGIN_TOP = 42;
const MARGIN_BOTTOM = 52;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const COL_GAP = 28;
const COL_WIDTH = (CONTENT_WIDTH - COL_GAP) / 2;

const FG = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.47, 0.55);
const ACCENT = rgb(0.15, 0.39, 0.92);
const LINE = rgb(0.86, 0.89, 0.93);
const HEADER_BG = rgb(0.96, 0.97, 0.98);
const STATUS_BG = rgb(0.93, 0.95, 0.99);
const TOTAL_LINE = rgb(0.78, 0.82, 0.88);

type PdfCtx = {
  doc: PDFDocument;
  page: PDFPage;
  pages: PDFPage[];
  font: PDFFont;
  fontBold: PDFFont;
  y: number;
  pageNo: number;
  meta: { reference: string; status: string; date: string };
};

type Kv = { label: string; value: string };

function money(value: unknown): string | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `INR ${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)}`;
}

function text(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ");
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
  const paragraphs = raw.split(/\r?\n/);
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        current = next;
      } else {
        if (current) lines.push(current);
        // Hard-break extremely long tokens
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let chunk = "";
          for (const ch of word) {
            const trial = chunk + ch;
            if (font.widthOfTextAtSize(trial, size) <= maxWidth) chunk = trial;
            else {
              if (chunk) lines.push(chunk);
              chunk = ch;
            }
          }
          current = chunk;
        } else {
          current = word;
        }
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function rightAlign(font: PDFFont, value: string, size: number, rightX: number) {
  const w = font.widthOfTextAtSize(pdfSafe(value), size);
  return rightX - w;
}

function drawFooterOnPage(ctx: PdfCtx, page: PDFPage, pageNo: number, totalPages: number) {
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
  page.drawText("Procurement Management", {
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

function newPage(ctx: PdfCtx, continued: boolean) {
  const page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.pages.push(page);
  ctx.page = page;
  ctx.pageNo += 1;
  ctx.y = PAGE_HEIGHT - MARGIN_TOP;
  drawContinuedHeader(ctx, continued);
}

function ensureSpace(ctx: PdfCtx, needed: number) {
  if (ctx.y - needed >= MARGIN_BOTTOM + 8) return;
  newPage(ctx, true);
}

function drawContinuedHeader(ctx: PdfCtx, continued: boolean) {
  // Top accent rule
  ctx.page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 4,
    width: PAGE_WIDTH,
    height: 4,
    color: ACCENT,
  });

  ctx.page.drawText("MedFlow", {
    x: MARGIN_X,
    y: ctx.y,
    size: 11,
    font: ctx.fontBold,
    color: ACCENT,
  });
  ctx.page.drawText(continued ? "Indent (continued)" : "Procurement Management", {
    x: MARGIN_X,
    y: ctx.y - 12,
    size: 8,
    font: ctx.font,
    color: MUTED,
  });

  const ref = `#${ctx.meta.reference}`;
  ctx.page.drawText(ref, {
    x: rightAlign(ctx.fontBold, ref, 10, PAGE_WIDTH - MARGIN_X),
    y: ctx.y,
    size: 10,
    font: ctx.fontBold,
    color: FG,
  });
  ctx.y -= 28;
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.y },
    thickness: 0.8,
    color: LINE,
  });
  ctx.y -= 18;
}

function drawDocumentHeader(ctx: PdfCtx, priority?: string) {
  ctx.page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 4,
    width: PAGE_WIDTH,
    height: 4,
    color: ACCENT,
  });

  // Left brand
  ctx.page.drawText("MedFlow", {
    x: MARGIN_X,
    y: ctx.y,
    size: 16,
    font: ctx.fontBold,
    color: ACCENT,
  });
  ctx.page.drawText("Procurement Management", {
    x: MARGIN_X,
    y: ctx.y - 14,
    size: 9,
    font: ctx.font,
    color: MUTED,
  });

  // Right indent identity
  const rightX = PAGE_WIDTH - MARGIN_X;
  ctx.page.drawText("INDENT", {
    x: rightAlign(ctx.fontBold, "INDENT", 9, rightX),
    y: ctx.y + 2,
    size: 9,
    font: ctx.fontBold,
    color: MUTED,
  });
  const ref = `#${ctx.meta.reference}`;
  ctx.page.drawText(ref, {
    x: rightAlign(ctx.fontBold, ref, 16, rightX),
    y: ctx.y - 16,
    size: 16,
    font: ctx.fontBold,
    color: FG,
  });

  ctx.y -= 36;

  // Meta row: date / priority / status chip
  const metaY = ctx.y;
  let cursorX = MARGIN_X;
  ctx.page.drawText("Date", {
    x: cursorX,
    y: metaY,
    size: 8,
    font: ctx.fontBold,
    color: MUTED,
  });
  cursorX += 28;
  ctx.page.drawText(ctx.meta.date, {
    x: cursorX,
    y: metaY,
    size: 9,
    font: ctx.font,
    color: FG,
  });
  cursorX += ctx.font.widthOfTextAtSize(ctx.meta.date, 9) + 18;

  if (priority) {
    ctx.page.drawText("Priority", {
      x: cursorX,
      y: metaY,
      size: 8,
      font: ctx.fontBold,
      color: MUTED,
    });
    cursorX += 40;
    ctx.page.drawText(pdfSafe(priority), {
      x: cursorX,
      y: metaY,
      size: 9,
      font: ctx.font,
      color: FG,
    });
  }

  const statusText = statusLabel(ctx.meta.status);
  const chipPadX = 8;
  const chipTextW = ctx.fontBold.widthOfTextAtSize(statusText, 8);
  const chipW = chipTextW + chipPadX * 2;
  const chipH = 16;
  const chipX = rightX - chipW;
  const chipY = metaY - 4;
  ctx.page.drawRectangle({
    x: chipX,
    y: chipY,
    width: chipW,
    height: chipH,
    color: STATUS_BG,
    borderColor: rgb(0.78, 0.84, 0.95),
    borderWidth: 0.6,
  });
  ctx.page.drawText(statusText, {
    x: chipX + chipPadX,
    y: chipY + 4.5,
    size: 8,
    font: ctx.fontBold,
    color: ACCENT,
  });

  ctx.y -= 22;
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.y },
    thickness: 1,
    color: LINE,
  });
  ctx.y -= 20;
}

function drawSectionTitle(ctx: PdfCtx, title: string) {
  ensureSpace(ctx, 30);
  ctx.page.drawText(title.toUpperCase(), {
    x: MARGIN_X,
    y: ctx.y,
    size: 8,
    font: ctx.fontBold,
    color: MUTED,
  });
  ctx.y -= 5;
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.y },
    thickness: 0.7,
    color: LINE,
  });
  ctx.y -= 14;
}

function drawTwoColumnBlock(ctx: PdfCtx, leftTitle: string, left: Kv[], rightTitle: string | null, right: Kv[]) {
  const hasRight = Boolean(rightTitle && right.length);
  const leftX = MARGIN_X;
  const rightX = MARGIN_X + COL_WIDTH + COL_GAP;

  const estimateCol = (items: Kv[]) =>
    items.reduce((sum, item) => {
      const lines = wrapLines(ctx.font, item.value || "-", 9, COL_WIDTH);
      return sum + 12 + Math.max(1, lines.length) * 11 + 6;
    }, 0);
  const needed = Math.max(estimateCol(left), hasRight ? estimateCol(right) : 0) + 28;
  ensureSpace(ctx, needed);

  ctx.page.drawText(leftTitle.toUpperCase(), {
    x: leftX,
    y: ctx.y,
    size: 8,
    font: ctx.fontBold,
    color: MUTED,
  });
  if (hasRight && rightTitle) {
    ctx.page.drawText(rightTitle.toUpperCase(), {
      x: rightX,
      y: ctx.y,
      size: 8,
      font: ctx.fontBold,
      color: MUTED,
    });
  }
  ctx.y -= 5;
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.y },
    thickness: 0.7,
    color: LINE,
  });
  ctx.y -= 14;

  const startY = ctx.y;
  let leftY = startY;
  for (const item of left) {
    ctx.page.drawText(pdfSafe(item.label), {
      x: leftX,
      y: leftY,
      size: 8,
      font: ctx.fontBold,
      color: MUTED,
    });
    leftY -= 12;
    const lines = wrapLines(ctx.font, item.value || "-", 9, COL_WIDTH);
    for (const line of lines.length ? lines : ["-"]) {
      ctx.page.drawText(line, { x: leftX, y: leftY, size: 9, font: ctx.font, color: FG });
      leftY -= 11;
    }
    leftY -= 6;
  }

  let rightY = startY;
  if (hasRight) {
    for (const item of right) {
      ctx.page.drawText(pdfSafe(item.label), {
        x: rightX,
        y: rightY,
        size: 8,
        font: ctx.fontBold,
        color: MUTED,
      });
      rightY -= 12;
      const lines = wrapLines(ctx.font, item.value || "-", 9, COL_WIDTH);
      for (const line of lines.length ? lines : ["-"]) {
        ctx.page.drawText(line, { x: rightX, y: rightY, size: 9, font: ctx.font, color: FG });
        rightY -= 11;
      }
      rightY -= 6;
    }
  }

  ctx.y = Math.min(leftY, hasRight ? rightY : leftY) - 4;
}

function drawParagraphBlock(ctx: PdfCtx, title: string | null, body: string) {
  if (title) {
    ensureSpace(ctx, 24);
    ctx.page.drawText(pdfSafe(title), {
      x: MARGIN_X,
      y: ctx.y,
      size: 9,
      font: ctx.fontBold,
      color: FG,
    });
    ctx.y -= 13;
  }
  const lines = wrapLines(ctx.font, body, 9, CONTENT_WIDTH);
  if (!lines.length) {
    ensureSpace(ctx, 14);
    ctx.page.drawText("-", { x: MARGIN_X, y: ctx.y, size: 9, font: ctx.font, color: FG });
    ctx.y -= 14;
    return;
  }
  for (const line of lines) {
    ensureSpace(ctx, 13);
    ctx.page.drawText(line || " ", {
      x: MARGIN_X,
      y: ctx.y,
      size: 9,
      font: ctx.font,
      color: FG,
    });
    ctx.y -= 12;
  }
  ctx.y -= 6;
}

function drawTotals(ctx: PdfCtx, rows: Kv[], grand: string | null) {
  drawSectionTitle(ctx, "Totals");
  const boxWidth = 220;
  const boxX = PAGE_WIDTH - MARGIN_X - boxWidth;
  const rowH = 16;
  const grandH = 22;
  const needed = rows.length * rowH + (grand ? grandH + 8 : 0) + 8;
  ensureSpace(ctx, needed);

  for (const row of rows) {
    ctx.page.drawText(pdfSafe(row.label), {
      x: boxX,
      y: ctx.y,
      size: 9,
      font: ctx.font,
      color: MUTED,
    });
    ctx.page.drawText(pdfSafe(row.value), {
      x: rightAlign(ctx.font, row.value, 9, PAGE_WIDTH - MARGIN_X),
      y: ctx.y,
      size: 9,
      font: ctx.font,
      color: FG,
    });
    ctx.y -= rowH;
  }

  if (grand) {
    ctx.y -= 2;
    ctx.page.drawLine({
      start: { x: boxX, y: ctx.y + 10 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.y + 10 },
      thickness: 0.8,
      color: TOTAL_LINE,
    });
    ctx.page.drawText("Grand total", {
      x: boxX,
      y: ctx.y - 4,
      size: 10,
      font: ctx.fontBold,
      color: FG,
    });
    ctx.page.drawText(pdfSafe(grand), {
      x: rightAlign(ctx.fontBold, grand, 11, PAGE_WIDTH - MARGIN_X),
      y: ctx.y - 4,
      size: 11,
      font: ctx.fontBold,
      color: FG,
    });
    ctx.y -= grandH;
  }
  ctx.y -= 8;
}

export type IndentPdfResult = {
  bytes: Uint8Array;
  filename: string;
  indentId: string;
  reference: string;
};

/** Builds a printable A4 indent PDF from live database data. */
export async function buildIndentPdf(indentId: string): Promise<IndentPdfResult> {
  const indent = await prisma.indent.findUnique({
    where: { id: indentId },
    include: {
      item: true,
      requester: true,
      approvalEvents: {
        include: { actor: { select: { name: true, role: true } } },
        orderBy: { createdAt: "asc" },
      },
      vendorSelection: {
        include: { selectedVendor: true, aiRecommendedVendor: true },
      },
      quotations: { include: { vendor: true } },
      purchaseOrders: true,
      invoices: true,
      stateHistory: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!indent || !indent.item || !indent.requester) throw new NotFoundError("Indent not found");

  const created =
    indent.createdAt != null
      ? new Date(String(indent.createdAt)).toISOString().slice(0, 10)
      : "-";

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const ctx: PdfCtx = {
    doc,
    page,
    pages: [page],
    font,
    fontBold,
    y: PAGE_HEIGHT - MARGIN_TOP,
    pageNo: 1,
    meta: {
      reference: String(indent.reference),
      status: String(indent.currentStatus),
      date: created,
    },
  };

  drawDocumentHeader(ctx, text(indent.priority) || undefined);

  // Requester + Vendor two-column
  const requesterFields: Kv[] = [
    { label: "Name", value: text(indent.requester.name) },
  ];
  if (indent.requester.email) requesterFields.push({ label: "Email", value: text(indent.requester.email) });
  if (indent.requester.department)
    requesterFields.push({ label: "Department", value: text(indent.requester.department) });
  if (indent.requester.role)
    requesterFields.push({ label: "Role", value: statusLabel(String(indent.requester.role)) });

  const selectedVendor = indent.vendorSelection?.selectedVendor as
    | { companyName?: string; contactPerson?: string; email?: string; phone?: string; city?: string }
    | null
    | undefined;

  const vendorFields: Kv[] = [];
  if (selectedVendor?.companyName) {
    vendorFields.push({ label: "Company", value: text(selectedVendor.companyName) });
    if (selectedVendor.contactPerson)
      vendorFields.push({ label: "Contact", value: text(selectedVendor.contactPerson) });
    if (selectedVendor.email) vendorFields.push({ label: "Email", value: text(selectedVendor.email) });
    if (selectedVendor.phone) vendorFields.push({ label: "Phone", value: text(selectedVendor.phone) });
    if (selectedVendor.city) vendorFields.push({ label: "City", value: text(selectedVendor.city) });
  }

  drawTwoColumnBlock(
    ctx,
    "Requester",
    requesterFields,
    vendorFields.length ? "Vendor" : null,
    vendorFields
  );

  // Procurement requirements
  const delivery = text(indent.procurementDeliveryExpectations);
  const commercial = text(indent.procurementCostCommercial);
  const specsReq = text(indent.procurementSpecifications);
  if (delivery || commercial || specsReq) {
    drawSectionTitle(ctx, "Procurement requirements");
    if (commercial) drawParagraphBlock(ctx, "Cost / commercial", commercial);
    if (delivery) drawParagraphBlock(ctx, "Delivery expectations", delivery);
    if (specsReq) drawParagraphBlock(ctx, "Specifications", specsReq);
  }

  // Item table
  drawSectionTitle(ctx, "Item details");

  const qty = Number(indent.quantity);
  const selectedVendorId = indent.vendorSelection?.selectedVendorId
    ? String(indent.vendorSelection.selectedVendorId)
    : null;
  const selectedQuote = selectedVendorId
    ? (indent.quotations as Array<{ vendorId: string; unitPrice: unknown }>).find(
        (q) => String(q.vendorId) === selectedVendorId
      )
    : undefined;
  const unitPriceNum =
    selectedQuote?.unitPrice != null && Number.isFinite(Number(selectedQuote.unitPrice))
      ? Number(selectedQuote.unitPrice)
      : null;
  const lineAmount =
    unitPriceNum != null && Number.isFinite(qty)
      ? unitPriceNum * qty
      : indent.estimatedAmount != null
        ? Number(indent.estimatedAmount)
        : null;

  const col = {
    item: { x: MARGIN_X, w: 118 },
    desc: { x: MARGIN_X + 118, w: 168 },
    qty: { x: MARGIN_X + 286, w: 46 },
    unit: { x: MARGIN_X + 332, w: 40 },
    price: { x: MARGIN_X + 372, w: 70 },
    amount: { x: MARGIN_X + 442, w: CONTENT_WIDTH - 442 },
  };

  const drawTableHeader = () => {
    ensureSpace(ctx, 24);
    const headerH = 20;
    ctx.page.drawRectangle({
      x: MARGIN_X,
      y: ctx.y - 6,
      width: CONTENT_WIDTH,
      height: headerH,
      color: HEADER_BG,
      borderColor: LINE,
      borderWidth: 0.6,
    });
    const headerY = ctx.y;
    const headers: Array<{ label: string; x: number; right?: boolean; w: number }> = [
      { label: "Item", x: col.item.x + 6, w: col.item.w },
      { label: "Description", x: col.desc.x + 4, w: col.desc.w },
      { label: "Qty", x: col.qty.x + col.qty.w - 4, right: true, w: col.qty.w },
      { label: "Unit", x: col.unit.x + 4, w: col.unit.w },
      { label: "Price", x: col.price.x + col.price.w - 4, right: true, w: col.price.w },
      { label: "Amount", x: col.amount.x + col.amount.w - 4, right: true, w: col.amount.w },
    ];
    for (const h of headers) {
      const tx = h.right ? rightAlign(fontBold, h.label, 8, h.x) : h.x;
      ctx.page.drawText(h.label, {
        x: tx,
        y: headerY,
        size: 8,
        font: fontBold,
        color: MUTED,
      });
    }
    ctx.y -= 24;
  };

  drawTableHeader();

  const itemName = text(indent.item.name);
  const sku = text(indent.item.sku);
  const descParts = [
    sku ? `SKU: ${sku}` : "",
    indent.item.category ? `Category: ${indent.item.category}` : "",
    text(indent.item.specNotes),
  ].filter(Boolean);
  const descLines = wrapLines(font, descParts.join("\n"), 8, col.desc.w - 8);
  const nameLines = wrapLines(fontBold, itemName, 9, col.item.w - 10);
  const rowLines = Math.max(nameLines.length, descLines.length, 1);
  const rowH = rowLines * 11 + 12;

  const pageBeforeRow = ctx.pageNo;
  ensureSpace(ctx, rowH + 8);
  if (ctx.pageNo !== pageBeforeRow) drawTableHeader();

  const topY = ctx.y;
  let nameY = topY;
  for (const line of nameLines.length ? nameLines : ["-"]) {
    ctx.page.drawText(line, {
      x: col.item.x + 6,
      y: nameY,
      size: 9,
      font: fontBold,
      color: FG,
    });
    nameY -= 11;
  }
  let descY = topY;
  for (const line of descLines.length ? descLines : ["-"]) {
    ctx.page.drawText(line, {
      x: col.desc.x + 4,
      y: descY,
      size: 8,
      font,
      color: FG,
    });
    descY -= 11;
  }

  const qtyText = Number.isFinite(qty) ? String(qty) : text(indent.quantity);
  const unitText = text(indent.item.uom) || "-";
  const priceText = unitPriceNum != null ? money(unitPriceNum)! : "-";
  const amountText = lineAmount != null ? money(lineAmount)! : "-";

  ctx.page.drawText(qtyText, {
    x: rightAlign(font, qtyText, 9, col.qty.x + col.qty.w - 4),
    y: topY,
    size: 9,
    font,
    color: FG,
  });
  ctx.page.drawText(unitText, {
    x: col.unit.x + 4,
    y: topY,
    size: 9,
    font,
    color: FG,
  });
  ctx.page.drawText(priceText, {
    x: rightAlign(font, priceText, 8, col.price.x + col.price.w - 4),
    y: topY,
    size: 8,
    font,
    color: FG,
  });
  ctx.page.drawText(amountText, {
    x: rightAlign(fontBold, amountText, 9, col.amount.x + col.amount.w - 4),
    y: topY,
    size: 9,
    font: fontBold,
    color: FG,
  });

  ctx.y = topY - rowH;
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y + 6 },
    end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.y + 6 },
    thickness: 0.5,
    color: LINE,
  });
  ctx.y -= 8;

  // Totals
  const estimated = money(indent.estimatedAmount);
  const approvalBudget = money(indent.approvalBudgetAmount);
  const grand = approvalBudget ?? (lineAmount != null ? money(lineAmount) : estimated);
  const totalRows: Kv[] = [];
  if (estimated) totalRows.push({ label: "Estimated", value: estimated });
  if (unitPriceNum != null && lineAmount != null) {
    totalRows.push({ label: "Line total", value: money(lineAmount)! });
  }
  if (approvalBudget) totalRows.push({ label: "Approval budget", value: approvalBudget });
  if (totalRows.length || grand) {
    drawTotals(ctx, totalRows.filter((r) => r.label !== "Grand total"), grand);
  }

  // Notes
  drawSectionTitle(ctx, "Notes / remarks");
  drawParagraphBlock(ctx, null, text(indent.justification) || "-");
  if (text(indent.rejectionReason)) {
    drawParagraphBlock(ctx, "Rejection reason", text(indent.rejectionReason));
  }

  // Approvals
  const approvals = (indent.approvalEvents ?? []) as Array<{
    stage: string;
    decision: string;
    remarks: string;
    createdAt: string;
    actor?: { name?: string; role?: string } | null;
  }>;
  drawSectionTitle(ctx, "Approval / workflow");
  if (!approvals.length) {
    drawParagraphBlock(ctx, null, "No approval decisions recorded yet.");
  } else {
    for (const a of approvals) {
      const when = a.createdAt
        ? `${new Date(String(a.createdAt)).toISOString().slice(0, 19).replace("T", " ")} UTC`
        : "-";
      const decision = statusLabel(String(a.decision));
      const stage = statusLabel(String(a.stage));
      ensureSpace(ctx, 48);
      // Stage + decision row
      ctx.page.drawText(pdfSafe(stage), {
        x: MARGIN_X,
        y: ctx.y,
        size: 9,
        font: fontBold,
        color: FG,
      });
      const decisionLabel = decision;
      ctx.page.drawText(decisionLabel, {
        x: rightAlign(fontBold, decisionLabel, 9, PAGE_WIDTH - MARGIN_X),
        y: ctx.y,
        size: 9,
        font: fontBold,
        color: decision === "REJECTED" ? rgb(0.55, 0.15, 0.15) : ACCENT,
      });
      ctx.y -= 13;
      const actorName = text(a.actor?.name) || "-";
      const actorRole = a.actor?.role ? statusLabel(String(a.actor.role)) : "";
      ctx.page.drawText(pdfSafe(actorRole ? `${actorName}  |  ${actorRole}` : actorName), {
        x: MARGIN_X,
        y: ctx.y,
        size: 8,
        font,
        color: MUTED,
      });
      ctx.page.drawText(pdfSafe(when), {
        x: rightAlign(font, when, 8, PAGE_WIDTH - MARGIN_X),
        y: ctx.y,
        size: 8,
        font,
        color: MUTED,
      });
      ctx.y -= 12;
      if (text(a.remarks)) {
        drawParagraphBlock(ctx, "Remarks", text(a.remarks));
      } else {
        ctx.y -= 4;
      }
      ctx.page.drawLine({
        start: { x: MARGIN_X, y: ctx.y + 2 },
        end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.y + 2 },
        thickness: 0.4,
        color: LINE,
      });
      ctx.y -= 10;
    }
  }

  // Related documents
  const pos = (indent.purchaseOrders ?? []) as Array<{ poNumber?: string; sentAt?: string | null }>;
  const invoices = (indent.invoices ?? []) as Array<{
    vendorName?: string;
    amount?: unknown;
    kind?: string;
  }>;
  if (pos.length || invoices.length) {
    drawSectionTitle(ctx, "Related documents");
    for (const po of pos) {
      drawParagraphBlock(
        ctx,
        "Purchase order",
        `${text(po.poNumber)}${po.sentAt ? ` | sent ${new Date(String(po.sentAt)).toISOString().slice(0, 10)}` : " | draft"}`
      );
    }
    for (const inv of invoices) {
      const amt = money(inv.amount);
      drawParagraphBlock(
        ctx,
        text(inv.kind) === "FINAL" ? "Final invoice" : "Invoice",
        `${text(inv.vendorName) || "-"}${amt ? ` | ${amt}` : ""}`
      );
    }
  }

  // Finalize footers with correct page counts
  const totalPages = ctx.pages.length;
  ctx.pages.forEach((p, idx) => drawFooterOnPage(ctx, p, idx + 1, totalPages));

  const bytes = await doc.save();
  const filename = `MedFlow-${indent.reference}-Indent.pdf`;
  return { bytes, filename, indentId: String(indent.id), reference: String(indent.reference) };
}

export function isDemoIndentAttachment(doc: {
  type?: unknown;
  storagePath?: unknown;
  logicalKey?: unknown;
  filename?: unknown;
}) {
  if (String(doc.type) !== "INDENT_ATTACHMENT") return false;
  const storage = String(doc.storagePath ?? "");
  const key = String(doc.logicalKey ?? "");
  if (storage.includes("demo/seed")) return true;
  if (key.startsWith("demo-indent")) return true;
  return false;
}
