import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { AuthorizationError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { prisma, query } from "@/lib/db";
import { canProcurement } from "@/lib/rbac/policies";
import { scoreQuotation, pickBestVendor, DEFAULT_WEIGHTS } from "@/server/scoring-engine";
import {
  narrateComparison,
  openaiChatModel,
  suitabilityCompareQuotations,
  type SuitabilityQuoteInput,
} from "@/server/openai/quotation-ai";
import { appendAudit } from "@/server/audit-service";
import { resolveIndentBudgetAmount } from "@/lib/budget-approval";
import { readQuotationDocumentText } from "@/server/quotation-document-text";

function normVendorName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** One row per vendor — keep highest score when multiple quotations exist for the same vendor. */
function dedupeVendorScoreRows<T extends { vendorId: string; total: number }>(rows: T[]): T[] {
  const byVendor = new Map<string, T>();
  for (const r of rows) {
    const prev = byVendor.get(r.vendorId);
    if (!prev || r.total > prev.total) byVendor.set(r.vendorId, r);
  }
  return [...byVendor.values()];
}

function dedupeQuoteInputsByVendor(quotes: SuitabilityQuoteInput[]): SuitabilityQuoteInput[] {
  const byName = new Map<string, SuitabilityQuoteInput>();
  for (const q of quotes) {
    const k = normVendorName(q.vendor);
    const prev = byName.get(k);
    if (!prev || q.scoreTotal > prev.scoreTotal) byName.set(k, q);
  }
  return [...byName.values()];
}

function readRequirementMatchPercent(v: Record<string, unknown>): number | null {
  const n = v.requirementMatchPercent;
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.min(100, Math.max(0, Math.round(n)));
  }
  if (typeof n === "string") {
    const p = Number.parseFloat(n);
    if (Number.isFinite(p)) return Math.min(100, Math.max(0, Math.round(p)));
  }
  return null;
}

function buildMatchBreakdown(
  rows: { vendorId: string; vendor: string }[],
  suitability: Record<string, unknown> | null
): {
  vendorId: string;
  vendor: string;
  requirementMatchPercent: number | null;
  dimensionScores: Record<string, unknown> | null;
}[] {
  if (!suitability || typeof suitability !== "object") return [];
  const arr = suitability.vendors;
  if (!Array.isArray(arr)) return [];
  const out: {
    vendorId: string;
    vendor: string;
    requirementMatchPercent: number | null;
    dimensionScores: Record<string, unknown> | null;
  }[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const v = raw as Record<string, unknown>;
    const name = String(v.vendor ?? "").trim();
    if (!name) continue;
    const row = rows.find((r) => normVendorName(r.vendor) === normVendorName(name));
    if (!row) continue;
    const dim = v.dimensionScores;
    const dimensionScores =
      dim && typeof dim === "object" && !Array.isArray(dim) ? (dim as Record<string, unknown>) : null;
    out.push({
      vendorId: row.vendorId,
      vendor: row.vendor,
      requirementMatchPercent: readRequirementMatchPercent(v),
      dimensionScores,
    });
  }
  return out;
}

function pickWinnerByRequirementMatch(
  breakdown: { vendorId: string; requirementMatchPercent: number | null }[]
): { vendorId: string | null; percent: number | null } {
  let best: { vendorId: string; percent: number } | null = null;
  for (const b of breakdown) {
    if (b.requirementMatchPercent == null) continue;
    if (!best || b.requirementMatchPercent > best.percent) {
      best = { vendorId: b.vendorId, percent: b.requirementMatchPercent };
    }
  }
  return best ? { vendorId: best.vendorId, percent: best.percent } : { vendorId: null, percent: null };
}

function normalizeVendorQuoteText(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 24_000);
  }
  return out;
}

export const POST = withApiHandler({
  params: idParam,
  body: false,
})(async ({ req, session, params }) => {
  if (!session) throw new UnauthorizedError();
  if (!canProcurement(session.role)) throw new AuthorizationError();
  const id = params.id;

  let procurementRequirementsExtra = "";
  let costRequirement = "";
  let deliveryRequirement = "";
  let specificationsRequirement = "";
  let vendorQuoteText: Record<string, string> = {};
  try {
    const ct = req.headers.get("content-type");
    if (ct?.includes("application/json")) {
      const b = (await req.json()) as {
        procurementRequirements?: string;
        costRequirement?: string;
        deliveryRequirement?: string;
        specificationsRequirement?: string;
        vendorQuoteText?: unknown;
      };
      if (typeof b?.procurementRequirements === "string") {
        procurementRequirementsExtra = b.procurementRequirements.trim();
      }
      if (typeof b?.costRequirement === "string") costRequirement = b.costRequirement.trim();
      if (typeof b?.deliveryRequirement === "string") deliveryRequirement = b.deliveryRequirement.trim();
      if (typeof b?.specificationsRequirement === "string") {
        specificationsRequirement = b.specificationsRequirement.trim();
      }
      vendorQuoteText = normalizeVendorQuoteText(b?.vendorQuoteText);
    }
  } catch {
    /* empty body */
  }

  const indent = await prisma.indent.findUniqueOrThrow({
    where: { id },
    include: {
      item: true,
      quotations: { include: { vendor: true, document: true } },
      rfqs: { orderBy: { sentAt: "desc" }, take: 1 },
    },
  });

  // Read-only: running a comparison must not rewrite the requirements or the
  // approval amount. "Save commercial requirements" is the only writer.
  const approvalBudgetAmount = resolveIndentBudgetAmount(indent);

  if (!indent.quotations.length) {
    throw new ValidationError(
      "Add at least one quotation (upload PDF/txt or save text quote) before comparing."
    );
  }

  const item = indent.item as {
    name: string;
    sku: string;
    uom: string;
    category: string;
    specNotes?: string | null;
  };

  const baselineRequirements = [
    `Case: ${indent.reference}`,
    `Item: ${item.name} (SKU ${item.sku}), UOM ${item.uom}, category ${item.category}.`,
    item.specNotes ? `Item specification / quality notes: ${item.specNotes}` : null,
    `Quantity requested: ${String(indent.quantity)}`,
    `Business justification: ${indent.justification}`,
  ]
    .filter(Boolean)
    .join("\n");

  const latestRfq = indent.rfqs[0] as { subject: string; bodyTemplate: string } | undefined;
  const rfqBlock = latestRfq
    ? [
        "",
        "--- Enquiry email (RFQ) sent to vendors (what we asked them) ---",
        `Subject: ${latestRfq.subject}`,
        `Body template:\n${latestRfq.bodyTemplate}`,
      ].join("\n")
    : "";

  const structuredThreePillars = [
    "--- Structured comparison targets (score dimensionScores against these) ---",
    `Cost / commercial requirements:\n${costRequirement || "(Not filled — infer from RFQ, item, and quantity only.)"}`,
    `Delivery / timeline requirements:\n${deliveryRequirement || "(Not filled — infer from RFQ and item only.)"}`,
    `Specifications / quality requirements:\n${specificationsRequirement || "(Not filled — use item spec notes and RFQ only.)"}`,
  ].join("\n\n");

  const procurementRequirements = [
    baselineRequirements,
    rfqBlock,
    structuredThreePillars,
    procurementRequirementsExtra
      ? `--- Additional procurement notes ---\n${procurementRequirementsExtra}`
      : "",
  ]
    .filter((x) => x.trim().length > 0)
    .join("\n\n");

  const prices = indent.quotations
    .map((q) => (q.unitPrice ? Number(q.unitPrice) : null))
    .filter((n): n is number => n != null);
  const refLow = prices.length ? Math.min(...prices) : null;
  const rows: { vendorId: string; vendor: string; breakdown: object; total: number }[] = [];
  const quoteInputs: SuitabilityQuoteInput[] = [];

  for (const q of indent.quotations) {
    const b = scoreQuotation(q, q.vendor, indent.item, refLow);
    await prisma.quotation.update({
      where: { id: q.id },
      data: {
        aiScoresJson: b as object,
      },
    });
    rows.push({
      vendorId: q.vendorId,
      vendor: q.vendor.companyName,
      breakdown: b,
      total: b.total,
    });

    let excerpt = "";
    const doc = q.document as { storagePath?: string; mimeType?: string } | null | undefined;
    if (doc?.storagePath && doc.mimeType) {
      try {
        excerpt = await readQuotationDocumentText(doc.storagePath, doc.mimeType);
      } catch {
        excerpt = "";
      }
    }
    const pastedFromBody = (vendorQuoteText[q.vendorId] ?? "").trim();
    const storedRaw = q.rawExtractionJson as Record<string, unknown> | null;
    const storedPaste =
      storedRaw && typeof storedRaw.userPastedQuote === "string" ? storedRaw.userPastedQuote.trim() : "";
    const pasted = pastedFromBody || storedPaste;
    if (pasted) {
      excerpt = excerpt
        ? `${excerpt}\n\n--- Vendor quote text (pasted for comparison) ---\n${pasted}`
        : pasted;
    }
    excerpt = excerpt.slice(0, 12000);
    quoteInputs.push({
      vendor: q.vendor.companyName,
      scoreTotal: b.total,
      scoreNotes: b.explain.join(" "),
      summaryFromExtract: (q.summaryText as string | null) ?? null,
      structuredJson: (q.rawExtractionJson as Record<string, unknown> | null) ?? null,
      pdfTextExcerpt: excerpt,
    });
  }

  const compareRows = dedupeVendorScoreRows(rows);
  const compareQuotes = dedupeQuoteInputsByVendor(quoteInputs);

  const winner = pickBestVendor(compareRows.map((r) => ({ vendorId: r.vendorId, total: r.total })));
  const winnerName = compareRows.find((r) => r.vendorId === winner)?.vendor ?? "";
  const inputHash = createHash("sha256")
    .update(
      JSON.stringify({
        model: openaiChatModel(),
        promptVersion: "v4-threepillars",
        weights: DEFAULT_WEIGHTS,
        procurementRequirements,
        quotes: compareQuotes,
      })
    )
    .digest("hex");
  const cached = await query<{ id: string; results_json: Record<string, unknown> }>(
    `SELECT id, results_json FROM ai_comparison_runs WHERE input_hash = $1 LIMIT 1`,
    [inputHash]
  );
  if (cached.rows[0]) {
    const r = cached.rows[0].results_json ?? {};
    return NextResponse.json({
      run: { id: cached.rows[0].id },
      cached: true,
      ...r,
      approvalBudgetAmount,
    });
  }
  // Suitability already returns executiveSummary — call narrate only as fallback
  // to avoid two OpenAI round-trips on every cache miss.
  let suitability: Record<string, unknown> | null = null;
  let suitabilityError: string | null = null;
  try {
    suitability = await suitabilityCompareQuotations({
      indentRef: indent.reference,
      quantity: String(indent.quantity),
      justification: indent.justification,
      procurementRequirements,
      item: {
        name: item.name,
        sku: item.sku,
        uom: item.uom,
        category: item.category,
        specNotes: item.specNotes ?? null,
      },
      quotes: compareQuotes,
    });
  } catch (e) {
    suitabilityError = e instanceof Error ? e.message : String(e);
  }

  const suitabilitySummary =
    typeof suitability?.executiveSummary === "string"
      ? suitability.executiveSummary.trim()
      : "";
  const narrative =
    suitabilitySummary ||
    (await narrateComparison({
      indentRef: indent.reference,
      itemName: indent.item.name,
      rows: compareRows.map((r) => ({
        vendor: r.vendor,
        totalScore: r.total,
        notes: (r.breakdown as { explain?: string[] }).explain?.join(" ") ?? "",
      })),
      winner: winnerName,
    }));

  const matchBreakdown = buildMatchBreakdown(
    compareRows.map((r) => ({ vendorId: r.vendorId, vendor: r.vendor })),
    suitability
  );
  const { vendorId: winnerVendorIdByRequirementMatch, percent: winnerRequirementMatchPercent } =
    pickWinnerByRequirementMatch(matchBreakdown);

  const run = await prisma.aiComparisonRun.create({
    data: {
      indentId: id,
      model: `${openaiChatModel()}+deterministic+suitability`,
      promptVersion: "v4-threepillars",
      inputHash,
      weightsJson: DEFAULT_WEIGHTS as object,
      resultsJson: {
        rows: compareRows,
        winnerVendorId: winner,
        winnerVendorIdByRequirementMatch,
        winnerRequirementMatchPercent,
        matchBreakdown,
        narrative,
        suitability,
        suitabilityError,
        procurementRequirements,
        structuredRequirements: {
          costRequirement: costRequirement || null,
          deliveryRequirement: deliveryRequirement || null,
          specificationsRequirement: specificationsRequirement || null,
        },
      } as object,
    },
  });
  await appendAudit({
    entityType: "Indent",
    entityId: id,
    action: "AI_COMPARE",
    actorId: session.sub,
    indentId: id,
    diff: { runId: run.id },
  });
  return NextResponse.json({
    run,
    rows: compareRows,
    winnerVendorId: winner,
    winnerVendorIdByRequirementMatch,
    winnerRequirementMatchPercent,
    matchBreakdown,
    narrative,
    suitability,
    suitabilityError,
    approvalBudgetAmount,
    structuredRequirements: {
      costRequirement: costRequirement || null,
      deliveryRequirement: deliveryRequirement || null,
      specificationsRequirement: specificationsRequirement || null,
    },
  });
});
